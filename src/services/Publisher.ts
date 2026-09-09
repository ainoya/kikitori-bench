import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildCharts, type ChartProvenance } from "./Charts.js";

import type { BenchmarkReport } from "../schemas/judge.js";
import { EVALUATION_AXES } from "../judge/scoring.js";
import { type Locale, t } from "../i18n/index.js";

/**
 * Produces the committable summary of a run.
 *
 * The full report quotes ground truth, hypotheses and judge rationales, and the
 * dataset is private, so nothing per-sample may leave the machine. This writer
 * only ever reads aggregate fields - leaderboard, analytics counts, usage totals
 * and the request parameters - and never the `evaluations` array. Sample ids and
 * the proper nouns that appear in `analytics.items` are deliberately dropped.
 */

const fmtUsd = (value: number | undefined): string =>
  value === undefined ? "-" : `$${value < 1 ? value.toFixed(4) : value.toFixed(2)}`;

const fmtInt = (value: number | undefined): string =>
  value === undefined ? "-" : value.toLocaleString("en-US");

const fmtDuration = (seconds: number): string => {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
};

/**
 * Where and when this output came from. A chart outlives the terminal it was
 * produced in, so it carries the revision that made it.
 */
export const chartProvenance = (): ChartProvenance => {
  const run = (args: readonly string[]): string | undefined => {
    try {
      return execFileSync("git", [...args], { encoding: "utf8" }).trim() || undefined;
    } catch {
      return undefined;
    }
  };

  const remote = run(["config", "--get", "remote.origin.url"]);
  const repository =
    remote
      ?.replace(/^git@([^:]+):/, "$1/")
      .replace(/^https?:\/\//, "")
      .replace(/\.git$/, "") ?? "github.com/ainoya/kikitori-bench";

  const commit = run(["rev-parse", "--short", "HEAD"]) ?? "uncommitted";
  const dirty = run(["status", "--porcelain"]) ? "+local changes" : "";

  return {
    date: new Date().toISOString().slice(0, 10),
    repository,
    commit: `${commit}${dirty}`
  };
};

export interface PublishOptions {
  report: BenchmarkReport;
  outDir: string;
  locale?: Locale;
  chartDir?: string;
}

export const publishRun = (options: PublishOptions): string[] => {
  const { report, outDir } = options;
  const i18n = t(options.locale);
  const chartDir = options.chartDir ?? path.join(outDir, "charts");
  fs.mkdirSync(chartDir, { recursive: true });

  const source = chartProvenance();
  const charts = buildCharts(report, source);
  const written: string[] = [];
  const chartFiles: Array<[string, string]> = [
    ["price-performance.svg", charts.costSvg],
    ["speed-performance.svg", charts.speedSvg],
    ["score-breakdown.svg", charts.breakdownSvg]
  ];
  for (const [name, svg] of chartFiles) {
    const file = path.join(chartDir, name);
    fs.writeFileSync(file, svg, "utf-8");
    written.push(file);
  }

  const axes = [...EVALUATION_AXES];
  const summary = report.usageSummary;
  const analytics = report.analytics;
  const conditions = report.conditions;
  const audioSeconds = summary?.perModel[0]?.audioSeconds ?? 0;
  const rel = (file: string) => path.relative(outDir, file).split(path.sep).join("/");

  const lines: string[] = [];
  lines.push("# Japanese voice-journal ASR benchmark");
  lines.push("");
  lines.push(
    "Transcription engines compared on unscripted Japanese voice-journal audio - " +
      "mostly single-speaker dictation, with some conversational passages. " +
      "Aggregate results only: the corpus behind these numbers is private and is not part of " +
      "this repository."
  );
  lines.push("");
  lines.push(`- **Samples**: ${conditions?.sampleCount ?? "-"}${
    conditions?.maxDurationSec !== undefined
      ? ` (each under ${Math.round(conditions.maxDurationSec / 60)} minutes, so every provider sees the same set)`
      : ""
  }`);
  lines.push(`- **Audio per model**: ${fmtDuration(audioSeconds)}`);
  lines.push(`- **Judge**: \`${report.judgeModel}\`, temperature \`${conditions?.judge.temperature ?? "default"}\``);
  lines.push(
    `- **Score**: ${axes
      .filter((axis) => axis === "proper_noun_f1" || axis === "proposition_f1")
      .map((axis) => i18n.axes[axis])
      .join(" and ")}, weighted ${Object.entries(conditions?.weights ?? {})
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`
  );
  lines.push("");

  lines.push("## Leaderboard");
  lines.push("");
  lines.push(
    `| # | ${i18n.model} | ${i18n.overall} | ${i18n.ciColumn} | ${axes.map((a) => i18n.axes[a]).join(" | ")} | ${i18n.rtf} | ${i18n.latencyPercentiles} |`
  );
  lines.push(`| :--- | :--- | :---: |${" :---: |".repeat(axes.length + 3)}`);
  report.leaderboard.forEach((entry, idx) => {
    const stats = analytics?.models.find((m) => m.modelId === entry.modelId);
    lines.push(
      `| ${idx + 1} | **${entry.displayName}** | **${entry.overallScore.toFixed(1)}%** | ${
        stats ? `[${stats.ciLow.toFixed(1)}, ${stats.ciHigh.toFixed(1)}]` : "-"
      } | ${axes.map((a) => `${(entry.categoryScores[a] ?? 0).toFixed(1)}%`).join(" | ")} | ${
        entry.averageRtf?.toFixed(2) ?? "-"
      }x | ${stats ? `${stats.latencyP50Ms} / ${stats.latencyP95Ms} ms` : "-"} |`
    );
  });
  lines.push("");
  lines.push(`![Price versus score](${rel(path.join(chartDir, "price-performance.svg"))})`);
  lines.push("");
  lines.push(`![Speed versus score](${rel(path.join(chartDir, "speed-performance.svg"))})`);
  lines.push("");
  lines.push(`![Score by axis](${rel(path.join(chartDir, "score-breakdown.svg"))})`);
  lines.push("");

  if (analytics) {
    lines.push(`## ${i18n.pairwiseSection}`);
    lines.push("");
    lines.push(`| ${i18n.model} A | ${i18n.model} B | Δ | ${i18n.ciColumn} | ${i18n.adjustedCi} | ${i18n.verdict} |`);
    lines.push("| :--- | :--- | :---: | :---: | :---: | :---: |");
    const nameOf = (id: string) =>
      analytics.models.find((m) => m.modelId === id)?.displayName ?? id;
    for (const cmp of analytics.pairwise) {
      const sign = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
      lines.push(
        `| ${nameOf(cmp.a)} | ${nameOf(cmp.b)} | ${sign(cmp.meanDiff)}pp | [${sign(cmp.ciLow)}, ${sign(cmp.ciHigh)}] | [${sign(cmp.adjustedCiLow)}, ${sign(cmp.adjustedCiHigh)}] | ${
          cmp.significantAdjusted ? "✅" : cmp.significant ? "🔸" : "➖"
        } |`
      );
    }
    lines.push("");
    lines.push(`> ${i18n.pairwiseNote}`);
    lines.push("");
    lines.push(
      `Discriminating samples: **${analytics.items.discriminating} / ${analytics.items.totalSamples}**` +
        analytics.items.axisDiscrimination
          .map((ax) => ` · ${i18n.axes[ax.axis]} ${ax.discriminating}/${analytics.items.totalSamples}`)
          .join("")
    );
    lines.push("");
  }

  if (summary) {
    lines.push(`## ${i18n.usageSection}`);
    lines.push("");
    lines.push(
      `| ${i18n.model} | ASR in | ASR out | ${i18n.asrCost} | Judge in | Judge out | ${i18n.judgeCost} | ${i18n.totalCost} |`
    );
    lines.push("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");
    for (const m of summary.perModel) {
      lines.push(
        `| **${m.displayName}** | ${fmtInt(m.asrUsage.inputTokens)} | ${fmtInt(m.asrUsage.outputTokens)} | ${
          m.asrCostEstimated ? "~" : ""
        }${fmtUsd(m.asrCostUsd)} | ${fmtInt(m.judgeUsage.inputTokens)} | ${fmtInt(m.judgeUsage.outputTokens)} | ${fmtUsd(
          m.judgeCostUsd
        )} | ${fmtUsd(m.totalCostUsd)} |`
      );
    }
    lines.push(
      `| **${i18n.costTotalsRow}** | | | **${fmtUsd(summary.totalAsrCostUsd)}** | | | **${fmtUsd(
        summary.totalJudgeCostUsd
      )}** | **${fmtUsd(summary.totalCostUsd)}** |`
    );
    lines.push("");
  }

  if (conditions && conditions.models.length > 0) {
    lines.push(`## ${i18n.conditionsSection}`);
    lines.push("");
    lines.push(`| ${i18n.model} | ${i18n.provider} | ${i18n.parameters} |`);
    lines.push("| :--- | :--- | :--- |");
    for (const cond of conditions.models) {
      const params = Object.entries(cond.parameters)
        .map(([key, value]) => `\`${key}\`: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
        .join("<br>");
      lines.push(`| **${cond.displayName}** | ${cond.provider} | ${params} |`);
    }
    lines.push("");
  }

  lines.push(
    `_Generated by \`kikitori publish\` from run \`${report.runId}\` on ${source.date}, ` +
      `at ${source.repository} @ \`${source.commit}\`._`
  );
  lines.push("");

  const target = path.join(outDir, "results.md");
  fs.writeFileSync(target, lines.join("\n"), "utf-8");
  written.push(target);
  return written;
};
