import * as fs from "node:fs";
import * as path from "node:path";
import { Context, Effect, Layer } from "effect";
import type { BenchmarkReport, ModelUsageSummary } from "../schemas/judge.js";
import type { EvaluationAxis } from "../schemas/config.js";
import { EVALUATION_AXES } from "../judge/scoring.js";
import { ValidationError } from "../errors.js";
import { type Locale, t } from "../i18n/index.js";

const AXIS_KEYS = EVALUATION_AXES;

/** " (30%)" suffix for the axes that carry an explicit weight. */
const weightLabel = (report: BenchmarkReport, axis: EvaluationAxis): string => {
  const weights = report.conditions?.weights as Record<string, number> | undefined;
  const weight =
    axis === "proper_noun_f1"
      ? weights?.["proper_noun_f1"]
      : axis === "proposition_f1"
        ? weights?.["proposition_quality"]
        : undefined;
  return weight === undefined ? "" : ` (${Math.round(weight * 100)}%)`;
};

const fmtParamValue = (value: unknown): string => {
  if (value === undefined || value === null) return "-";
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join(", ") : "(none)";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
};

const fmtUsd = (value: number | undefined, estimated = false): string => {
  if (value === undefined) return "-";
  const prefix = estimated ? "~" : "";
  // Sub-cent totals are common for short clips, so keep four decimals.
  return `${prefix}$${value < 1 ? value.toFixed(4) : value.toFixed(2)}`;
};

const fmtTokens = (value: number | undefined): string =>
  value === undefined ? "-" : value.toLocaleString("en-US");

const fmtSeconds = (seconds: number): string =>
  seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s` : `${seconds.toFixed(1)}s`;

const asrInputCell = (m: ModelUsageSummary): string => {
  const total = m.asrUsage.inputTokens;
  const audio = m.asrUsage.audioInputTokens;
  const text = m.asrUsage.textInputTokens;
  if (total === undefined && audio === undefined) return "-";
  const split =
    audio !== undefined || text !== undefined
      ? ` (${fmtTokens(audio)} / ${fmtTokens(text)})`
      : "";
  return `${fmtTokens(total ?? audio)}${split}`;
};

const judgeInputCell = (m: ModelUsageSummary): string => {
  const total = m.judgeUsage.inputTokens;
  if (total === undefined) return "-";
  return `${fmtTokens(total)} (${fmtTokens(m.judgeUsage.cachedInputTokens ?? 0)})`;
};

const judgeOutputCell = (m: ModelUsageSummary): string => {
  const total = m.judgeUsage.outputTokens;
  if (total === undefined) return "-";
  return `${fmtTokens(total)} (${fmtTokens(m.judgeUsage.reasoningOutputTokens ?? 0)})`;
};

export interface ReporterShape {
  renderConsoleLeaderboard(report: BenchmarkReport, locale?: Locale): void;
  generateMarkdownReport(report: BenchmarkReport, locale?: Locale): Effect.Effect<string, ValidationError>;
}

export class Reporter extends Context.Tag("Reporter")<Reporter, ReporterShape>() {}

export const ReporterLive = Layer.succeed(
  Reporter,
  Reporter.of({
    renderConsoleLeaderboard(report: BenchmarkReport, locale?: Locale) {
      const i18n = t(locale);
      console.log("\n" + "=".repeat(101));
      console.log(`  🏆 ${i18n.leaderboardTitle}`);
      console.log(`  ${i18n.dataset}: ${report.datasetName} | ${i18n.judge}: ${report.judgeModel} | ${i18n.run}: ${report.runId}`);
      console.log("=".repeat(101));

      const header = [
        i18n.rank.padEnd(5),
        i18n.model.padEnd(20),
        i18n.overall.padStart(9),
        i18n.properNounF1.padStart(9),
        i18n.propositionRecall.padStart(11),
        i18n.propositionPrecision.padStart(11),
        i18n.propositionF1.padStart(8),
        i18n.rtf.padStart(8),
        i18n.latency.padStart(10),
        i18n.totalCost.padStart(10)
      ].join(" | ");

      console.log(header);
      console.log("-".repeat(101));

      report.leaderboard.forEach((entry, idx) => {
        const rank = `#${idx + 1}`.padEnd(5);
        const name = entry.displayName.slice(0, 20).padEnd(20);
        const overall = `${entry.overallScore.toFixed(1)}%`.padStart(9);
        const terms = `${entry.categoryScores.proper_noun_f1.toFixed(1)}%`.padStart(9);
        const recall = `${entry.categoryScores.proposition_recall.toFixed(1)}%`.padStart(11);
        const precision = `${entry.categoryScores.proposition_precision.toFixed(1)}%`.padStart(11);
        const f1 = `${entry.categoryScores.proposition_f1.toFixed(1)}%`.padStart(8);
        const rtfStr = (entry.averageRtf !== undefined ? `${entry.averageRtf.toFixed(2)}x` : "-").padStart(8);
        const lat = `${entry.averageLatencyMs}ms`.padStart(10);
        const cost = fmtUsd(entry.totalCostUsd).padStart(10);

        console.log(
          [rank, name, overall, terms, recall, precision, f1, rtfStr, lat, cost].join(" | ")
        );
      });

      console.log("=".repeat(101));

      const analytics = report.analytics;
      if (analytics) {
        console.log(`  📊 ${i18n.pairwiseSection}`);
        console.log("-".repeat(101));
        for (const m of [...analytics.models].sort((a, b) => b.overallScore - a.overallScore)) {
          console.log(
            `${m.displayName.slice(0, 20).padEnd(20)} | ${`${m.overallScore.toFixed(1)}%`.padStart(7)} | ${i18n.ciColumn} [${m.ciLow.toFixed(1)}, ${m.ciHigh.toFixed(1)}]`.padEnd(52) +
              `| ${i18n.termRecall} ${`${m.termRecallPercent.toFixed(1)}%`.padStart(6)} | p50/p95 ${m.latencyP50Ms}/${m.latencyP95Ms} ms`
          );
        }
        for (const cmp of analytics.pairwise) {
          const nameOf = (id: string) =>
            analytics.models.find((m) => m.modelId === id)?.displayName ?? id;
          const mark = cmp.significantAdjusted ? "✅" : cmp.significant ? "🔸" : "➖";
          console.log(
            `  ${mark} ${nameOf(cmp.a)} − ${nameOf(cmp.b)}: ${cmp.meanDiff >= 0 ? "+" : ""}${cmp.meanDiff.toFixed(1)}pp  ${i18n.ciColumn} [${cmp.ciLow >= 0 ? "+" : ""}${cmp.ciLow.toFixed(1)}, ${cmp.ciHigh >= 0 ? "+" : ""}${cmp.ciHigh.toFixed(1)}]`
          );
        }
        console.log(`  ✅ ${i18n.significantAdjusted} / 🔸 ${i18n.significantUnadjusted} / ➖ ${i18n.notSignificant}`);
        console.log(
          `  ${i18n.itemSection}: ${analytics.items.discriminating}/${analytics.items.totalSamples} discriminating samples | per axis: ` +
            analytics.items.axisDiscrimination
              .map((ax) => `${i18n.axes[ax.axis]} ${ax.discriminating}/${analytics.items.totalSamples}`)
              .join(", ")
        );
        console.log("=".repeat(101));
      }

      const summary = report.usageSummary;
      if (summary) {
        console.log(`  💰 ${i18n.usageSection}`);
        console.log("-".repeat(101));
        console.log(
          [
            i18n.model.padEnd(20),
            i18n.audioLength.padStart(9),
            "ASR in".padStart(12),
            "ASR out".padStart(9),
            i18n.asrCost.padStart(10),
            "Judge in".padStart(12),
            "Judge out".padStart(10),
            i18n.judgeCost.padStart(10)
          ].join(" | ")
        );
        for (const m of summary.perModel) {
          console.log(
            [
              m.displayName.slice(0, 20).padEnd(20),
              fmtSeconds(m.audioSeconds).padStart(9),
              fmtTokens(m.asrUsage.inputTokens).padStart(12),
              fmtTokens(m.asrUsage.outputTokens).padStart(9),
              fmtUsd(m.asrCostUsd, m.asrCostEstimated).padStart(10),
              fmtTokens(m.judgeUsage.inputTokens).padStart(12),
              fmtTokens(m.judgeUsage.outputTokens).padStart(10),
              fmtUsd(m.judgeCostUsd).padStart(10)
            ].join(" | ")
          );
        }
        console.log("-".repeat(101));
        console.log(
          `  ${i18n.costTotalsRow}: ${i18n.asrCost} ${fmtUsd(summary.totalAsrCostUsd)} + ${i18n.judgeCost} ${fmtUsd(summary.totalJudgeCostUsd)} = ${fmtUsd(summary.totalCostUsd)}`
        );
        console.log("=".repeat(101));
      }

      console.log("");
    },

    generateMarkdownReport(report: BenchmarkReport, locale?: Locale) {
      return Effect.gen(this, function* () {
        const i18n = t(locale);
        const reportsDir = path.resolve(process.cwd(), "reports");
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }

        const lines: string[] = [];
        lines.push(`# ${i18n.reportTitle} (${report.runId})`);
        lines.push("");
        lines.push(`- **${i18n.dataset}**: \`${report.datasetName}\``);
        lines.push(`- **${i18n.evalTimestamp}**: \`${report.timestamp}\``);
        lines.push(`- **${i18n.judge}**: \`${report.judgeModel}\` (Codex App Server)`);
        lines.push("");
        lines.push(`## ${i18n.leaderboardSection}`);
        lines.push("");
        lines.push(
          `| ${i18n.rank} | ${i18n.model} | ${i18n.overall} | ${AXIS_KEYS.map((axis) => `${i18n.axes[axis]}${weightLabel(report, axis)}`).join(" | ")} | ${i18n.rtf} | ${i18n.latency} | ${i18n.totalCost} |`
        );
        lines.push(
          "| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
        );

        report.leaderboard.forEach((entry, idx) => {
          const rtfVal = entry.averageRtf !== undefined ? `**${entry.averageRtf.toFixed(2)}x**` : "-";
          lines.push(
            `| ${idx + 1} | **${entry.displayName}** | **${entry.overallScore.toFixed(1)}%** | ${AXIS_KEYS.map((axis) => `${(entry.categoryScores[axis] ?? 0).toFixed(1)}%`).join(" | ")} | ${rtfVal} | ${entry.averageLatencyMs} ms | ${fmtUsd(entry.totalCostUsd)} |`
          );
        });

        const analytics = report.analytics;
        if (analytics) {
          const nameOf = (modelId: string) =>
            analytics.models.find((m) => m.modelId === modelId)?.displayName ?? modelId;

          lines.push("");
          lines.push(`## ${i18n.reliabilitySection}`);
          lines.push("");
          lines.push(
            `| ${i18n.model} | ${i18n.overall} | ${i18n.ciColumn} | ${i18n.termRecall} | ${i18n.latencyPercentiles} | ${i18n.emptyOutputs} |`
          );
          lines.push("| :--- | :---: | :---: | :---: | :---: | :---: |");
          for (const m of [...analytics.models].sort((a, b) => b.overallScore - a.overallScore)) {
            lines.push(
              `| **${m.displayName}** | ${m.overallScore.toFixed(1)}% | [${m.ciLow.toFixed(1)}, ${m.ciHigh.toFixed(1)}] | ${m.termRecallPercent.toFixed(1)}% (${m.termsMatched}/${m.termsTotal}) | ${m.latencyP50Ms} / ${m.latencyP95Ms} ms | ${m.emptyOutputs} |`
            );
          }
          lines.push("");
          lines.push(
            `> ${i18n.termRecall}: proper nouns and numbers extracted from the reference and the hypothesis by the same morphological analyser, compared as sets - independent of the judge.`
          );

          lines.push("");
          lines.push(`### ${i18n.pairwiseSection}`);
          lines.push("");
          lines.push(
            `| ${i18n.model} A | ${i18n.model} B | Δ | ${i18n.ciColumn} | ${i18n.adjustedCi} | ${i18n.verdict} | McNemar p (${AXIS_KEYS.map((a) => i18n.axes[a]).join(" / ")}) |`
          );
          lines.push("| :--- | :--- | :---: | :---: | :---: | :---: | :---: |");
          for (const cmp of analytics.pairwise) {
            const ps = AXIS_KEYS.map((axis) => {
              const found = cmp.axes.find((x) => x.axis === axis);
              return found ? found.pValue.toFixed(3) : "-";
            }).join(" / ");
            lines.push(
              `| ${nameOf(cmp.a)} | ${nameOf(cmp.b)} | ${cmp.meanDiff >= 0 ? "+" : ""}${cmp.meanDiff.toFixed(1)}pp | [${cmp.ciLow >= 0 ? "+" : ""}${cmp.ciLow.toFixed(1)}, ${cmp.ciHigh >= 0 ? "+" : ""}${cmp.ciHigh.toFixed(1)}] | [${cmp.adjustedCiLow >= 0 ? "+" : ""}${cmp.adjustedCiLow.toFixed(1)}, ${cmp.adjustedCiHigh >= 0 ? "+" : ""}${cmp.adjustedCiHigh.toFixed(1)}] | ${cmp.significantAdjusted ? "✅" : cmp.significant ? "🔸" : "➖"} | ${ps} |`
            );
          }
          lines.push("");
          lines.push(`> ${i18n.pairwiseNote}`);

          lines.push("");
          lines.push(`### ${i18n.itemSection}`);
          lines.push("");
          const it = analytics.items;
          lines.push(
            `- ${i18n.samples}: **${it.totalSamples}** (discriminating: **${it.discriminating}**, every model scored 0: **${it.allModelsFail.length}**, every model scored 100: **${it.allModelsPass.length}**)`
          );
          if (it.allModelsFail.length > 0) {
            lines.push(
              `- Every model failed: ${it.allModelsFail.map((id) => `\`${id}\``).join(", ")} - check the ground truth and audio of these before trusting the score.`
            );
          }
          lines.push("");
          lines.push(`| ${i18n.checkItem} | discriminating | all pass | all fail |`);
          lines.push("| :--- | :---: | :---: | :---: |");
          for (const ax of it.axisDiscrimination) {
            lines.push(
              `| ${i18n.axes[ax.axis]} | **${ax.discriminating}** / ${it.totalSamples} | ${ax.allPass} | ${ax.allFail} |`
            );
          }
          lines.push("");
          if (it.termsMissedByAll.length > 0) {
            lines.push(
              `- Expected terms missed by every model: ${it.termsMissedByAll.map((t) => `\`${t}\``).join(", ")}`
            );
          }
        }

        const conditions = report.conditions;
        if (conditions) {
          lines.push("");
          lines.push(`## ${i18n.conditionsSection}`);
          lines.push("");
          lines.push(
            `- **${i18n.judgeSettings}**: \`${conditions.judge.model}\` (${conditions.judge.provider}, ${conditions.judge.endpoint}, temperature: \`${conditions.judge.temperature ?? "default"}\`)`
          );
          lines.push(
            `- **${i18n.samples}**: ${conditions.sampleCount}${
              conditions.maxDurationSec !== undefined
                ? ` (${conditions.maxDurationSec}s cap; ${conditions.excludedByDuration ?? 0} longer samples excluded so every provider sees the same set)`
                : ""
            } | **${i18n.overall} weights**: ${Object.entries(
              conditions.weights
            )
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}`
          );
          lines.push("");
          lines.push(`| ${i18n.model} | ${i18n.provider} | ${i18n.parameters} |`);
          lines.push("| :--- | :--- | :--- |");
          for (const cond of conditions.models) {
            const params = Object.entries(cond.parameters)
              .map(([key, value]) => `\`${key}\`: ${fmtParamValue(value)}`)
              .join("<br>");
            lines.push(`| **${cond.displayName}** | ${cond.provider} | ${params} |`);
          }
        }

        const summary = report.usageSummary;
        if (summary) {
          lines.push("");
          lines.push(`## ${i18n.usageSection}`);
          lines.push("");
          lines.push(
            `| ${i18n.model} | ${i18n.samples} | ${i18n.audioLength} | ${i18n.asrInputTokens} | ${i18n.asrOutputTokens} | ${i18n.asrCost} | ${i18n.judgeInputTokens} | ${i18n.judgeOutputTokens} | ${i18n.judgeCost} | ${i18n.totalCost} |`
          );
          lines.push(
            "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
          );
          for (const m of summary.perModel) {
            lines.push(
              `| **${m.displayName}** | ${m.sampleCount} | ${fmtSeconds(m.audioSeconds)} | ${asrInputCell(m)} | ${fmtTokens(m.asrUsage.outputTokens)} | ${fmtUsd(m.asrCostUsd, m.asrCostEstimated)} | ${judgeInputCell(m)} | ${judgeOutputCell(m)} | ${fmtUsd(m.judgeCostUsd)} | **${fmtUsd(m.totalCostUsd, m.asrCostEstimated)}** |`
            );
          }
          lines.push(
            `| **${i18n.costTotalsRow}** | | | | | **${fmtUsd(summary.totalAsrCostUsd)}** | | | **${fmtUsd(summary.totalJudgeCostUsd)}** | **${fmtUsd(summary.totalCostUsd)}** |`
          );
          lines.push("");
          lines.push(`> ${i18n.estimatedNote}`);
          lines.push(`> ${i18n.noPricingNote}`);
        }

        lines.push("");
        lines.push("---");
        lines.push("");
        lines.push(`## ${i18n.sampleDetails}`);
        lines.push("");

        // Group evaluations by sampleId
        const sampleIds = Array.from(new Set(report.evaluations.map((e) => e.sampleId)));

        for (const sId of sampleIds) {
          const sampleEvals = report.evaluations.filter((e) => e.sampleId === sId);
          const first = sampleEvals[0];
          if (!first) continue;

          lines.push(`### ${i18n.sample}: \`${sId}\``);
          lines.push("");
          lines.push(`**${i18n.groundTruth}**:`);
          lines.push(`> ${first.groundTruth || i18n.notSet}`);
          lines.push("");

          for (const ev of sampleEvals) {
            const modelName =
              report.leaderboard.find((l) => l.modelId === ev.modelId)?.displayName ?? ev.modelId;
            lines.push(`#### ${i18n.model}: ${modelName} (${i18n.score}: ${ev.overallScore.toFixed(1)}%)`);
            lines.push("");
            const rtfSample = ev.rtf !== undefined ? `${ev.rtf.toFixed(2)}x` : "-";
            const durSample = ev.audioDurationMs ? `${(ev.audioDurationMs / 1000).toFixed(1)}s` : "-";
            const latSample = ev.latencyMs !== undefined ? `${ev.latencyMs} ms` : "-";
            const costSample = fmtUsd(ev.asrCostUsd, ev.asrCostEstimated === true);
            const judgeTokensSample = fmtTokens(ev.judgeUsage?.totalTokens);
            const hallucSample =
              ev.hallucinationsPerMinute !== undefined
                ? ` | **${i18n.hallucinationRate}**: \`${ev.hallucinationsPerMinute.toFixed(2)}\` (${ev.hallucinationsCritical ?? 0} critical, ${ev.hallucinationsMinor ?? 0} minor)`
                : "";
            lines.push(
              `- **${i18n.rtf}**: \`${rtfSample}\` | **${i18n.latency}**: \`${latSample}\` | **${i18n.audioDuration}**: \`${durSample}\` | **${i18n.asrCost}**: \`${costSample}\` | **${i18n.judgeCost}**: \`${fmtUsd(ev.judgeCostUsd)}\` (${judgeTokensSample} tok)${hallucSample}`
            );
            lines.push("");
            lines.push(`**${i18n.hypothesis}**:`);
            lines.push(`> ${ev.hypothesis || i18n.noOutput}`);
            lines.push("");
            lines.push(`| ${i18n.checkItem} | ${i18n.verdict} | ${i18n.reasonAndEvidence} |`);
            lines.push("| :--- | :---: | :--- |");

            for (const ch of ev.checks) {
              const statusBadge = ch.pass ? `✅ ${i18n.passBadge}` : `❌ ${i18n.failBadge}`;
              const reason = ch.reason.replace(/\|/g, "\\|");
              const evidence = ch.evidence ? ` (${ch.evidence.replace(/\|/g, "\\|")})` : "";
              lines.push(`| ${ch.name} | ${statusBadge} | ${reason}${evidence} |`);
            }
            lines.push("");
          }
          lines.push("---");
          lines.push("");
        }

        const mdContent = lines.join("\n");
        const reportFilePath = path.resolve(reportsDir, `${report.runId}.md`);

        try {
          fs.writeFileSync(reportFilePath, mdContent, "utf-8");
        } catch (err) {
          return yield* Effect.fail(
            new ValidationError({
              message: `Failed to write markdown report to ${reportFilePath}: ${String(err)}`,
              details: err
            })
          );
        }

        return reportFilePath;
      });
    }
  })
);
