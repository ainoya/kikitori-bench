import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import {
  WebSocketCodexClient,
  MockCodexClient,
  isFatalJudgeError,
  type CodexClient,
} from "../judge/codex-client.js";
import { buildJudgePrompt } from "../judge/prompts.js";
import { judgeOnce } from "../judge/turn.js";
import { DEFAULT_F_BETA, scoreVerdict, type JudgeVerdict } from "../judge/scoring.js";
import type { AppConfig } from "../schemas/config.js";
import type { DatasetItem } from "../schemas/dataset.js";
import type { BenchmarkReport, SampleEvaluation } from "../schemas/judge.js";
import { cohensKappa, percentile, sampleWithoutReplacement } from "../utils/stats.js";
import { getTokenizer, scoreProperNouns } from "../judge/lexical.js";
import type { JudgeConnectionError, JudgeEvaluationError } from "../errors.js";

export interface ConsistencyResult {
  runId: string;
  judgeModel: string;
  pairsCompared: number;
  /** |score difference| between the two independent judgements of a sample. */
  meanAbsScoreDelta: number;
  medianAbsScoreDelta: number;
  p95AbsScoreDelta: number;
  termAgreement: { agreement: number; kappa: number; n: number };
  keyPointAgreement: { agreement: number; kappa: number; n: number };
  insertionCountDelta: number;
  samples: Array<{
    sampleId: string;
    modelId: string;
    firstScore: number;
    secondScore: number;
  }>;
}

const verdictOf = (verdict: JudgeVerdict, index: number): string =>
  verdict.keyPoints.find((k) => k.index === index)?.verdict ?? "absent";

const termOf = (verdict: JudgeVerdict, term: string): string => {
  const found = verdict.terms.find((t) => t.term === term);
  return found === undefined ? "absent" : found.present ? "present" : "missing";
};

/** Reconstruct the first judgement's per-item verdicts from its stored checks. */
const firstPassVerdict = (evaluation: SampleEvaluation, item: DatasetItem): JudgeVerdict => ({
  terms: item.expectedTerms.map((term) => ({
    term,
    present: evaluation.checks.find((c) => c.id === `term_${term}`)?.pass ?? false,
  })),
  keyPoints: item.keyPoints.map((_, idx) => {
    const coverage = evaluation.checks.find((c) => c.id === `point_${idx + 1}_coverage`);
    const fidelity = evaluation.checks.find((c) => c.id === `point_${idx + 1}_fidelity`);
    const verdict =
      coverage?.pass === true ? "present" : fidelity?.pass === false ? "contradicted" : "missing";
    return { index: idx + 1, verdict: verdict as "present" | "missing" | "contradicted" };
  }),
  insertions: evaluation.checks
    .filter((c) => c.id.startsWith("insertion_"))
    .map((c) => ({ text: c.evidence ?? c.name, severity: c.severity ?? "critical" })),
});

/**
 * Judge a subsample a second time and measure how much the verdict moves.
 * A benchmark whose judge disagrees with itself cannot resolve differences
 * smaller than that disagreement, so this bounds every other number in a run.
 */
export const measureJudgeConsistency = (
  report: BenchmarkReport,
  items: readonly DatasetItem[],
  config: AppConfig,
  options: { count: number; seed: number; concurrency: number; useMockJudge?: boolean },
): Effect.Effect<ConsistencyResult, JudgeConnectionError | JudgeEvaluationError> =>
  Effect.gen(function* () {
    const itemMap = new Map(items.map((it) => [it.id, it]));
    const client: CodexClient =
      options.useMockJudge || config.judge.provider === "mock"
        ? new MockCodexClient()
        : new WebSocketCodexClient(config.judge.endpoint, config.judge.timeoutMs ?? 600_000);

    const candidates = report.evaluations.filter(
      (e) => e.hypothesis.trim().length > 0 && itemMap.has(e.sampleId),
    );
    const picked = sampleWithoutReplacement(candidates, options.count, options.seed);

    const tokenizer = yield* Effect.promise(() => getTokenizer());

    const rejudge = (evaluation: SampleEvaluation) =>
      Effect.gen(function* () {
        const item = itemMap.get(evaluation.sampleId)!;
        const result = yield* judgeOnce({
          client,
          judgeModel: config.judge.model,
          ...(config.judge.temperature !== undefined
            ? { temperature: config.judge.temperature }
            : {}),
          prompt: buildJudgePrompt({
            item,
            hypothesis: evaluation.hypothesis,
            modelId: evaluation.modelId,
          }),
          item,
          modelId: evaluation.modelId,
        }).pipe(
          Effect.retry({
            times: config.judge.retries ?? 2,
            while: (err) => !isFatalJudgeError(err),
          }),
        );

        const scored = scoreVerdict({
          verdict: result.verdict,
          item,
          audioDurationMs: evaluation.audioDurationMs ?? 0,
          weights: config.weights,
          fBeta: config.scoring?.fBeta ?? DEFAULT_F_BETA,
          lexical: scoreProperNouns(tokenizer, item.groundTruth, evaluation.hypothesis),
        });

        console.log(
          `   ↺ ${evaluation.modelId} / ${evaluation.sampleId}: ${evaluation.overallScore.toFixed(1)}% → ${scored.overallScore.toFixed(1)}%`,
        );

        return { evaluation, item, second: result.verdict, secondScore: scored.overallScore };
      });

    const results = yield* Effect.all(picked.map(rejudge), { concurrency: options.concurrency });

    const termPairs: Array<readonly [string, string]> = [];
    const pointPairs: Array<readonly [string, string]> = [];
    let insertionDelta = 0;

    for (const r of results) {
      const first = firstPassVerdict(r.evaluation, r.item);
      for (const term of r.item.expectedTerms) {
        termPairs.push([termOf(first, term), termOf(r.second, term)]);
      }
      for (let i = 1; i <= r.item.keyPoints.length; i++) {
        pointPairs.push([verdictOf(first, i), verdictOf(r.second, i)]);
      }
      insertionDelta += Math.abs(first.insertions.length - r.second.insertions.length);
    }

    const deltas = results.map((r) => Math.abs(r.evaluation.overallScore - r.secondScore));
    const mean = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;

    return {
      runId: report.runId,
      judgeModel: config.judge.model,
      pairsCompared: results.length,
      meanAbsScoreDelta: Math.round(mean * 10) / 10,
      medianAbsScoreDelta: Math.round(percentile(deltas, 50) * 10) / 10,
      p95AbsScoreDelta: Math.round(percentile(deltas, 95) * 10) / 10,
      termAgreement: cohensKappa(termPairs),
      keyPointAgreement: cohensKappa(pointPairs),
      insertionCountDelta:
        results.length > 0 ? Math.round((insertionDelta / results.length) * 100) / 100 : 0,
      samples: results.map((r) => ({
        sampleId: r.evaluation.sampleId,
        modelId: r.evaluation.modelId,
        firstScore: r.evaluation.overallScore,
        secondScore: r.secondScore,
      })),
    };
  });

export interface AuditEntry {
  sampleId: string;
  modelId: string;
  checkId: string;
  checkName: string;
  judgeVerdict: "pass" | "fail";
  judgeReason: string;
  evidence: string;
  groundTruth: string;
  hypothesis: string;
  /** Fill in with pass / fail / unsure. */
  humanVerdict: string;
}

/**
 * Draw a worksheet of individual checks for a person to label.
 *
 * Sampling is stratified over model x check kind x verdict and filled
 * round-robin. Balancing only pass against fail is not enough: it produced a
 * sheet that was three quarters Gemini, so the audit said nothing about how the
 * judge treats the weaker models, whose mistakes look completely different.
 */
export const buildAuditWorksheet = (
  report: BenchmarkReport,
  count: number,
  seed: number,
): AuditEntry[] => {
  const strata = new Map<string, AuditEntry[]>();

  for (const evaluation of report.evaluations) {
    for (const check of evaluation.checks) {
      const kind = check.id.startsWith("proper_")
        ? "proper-noun"
        : check.id.startsWith("insertion_")
          ? "insertion"
          : check.id.endsWith("_fidelity")
            ? "contradiction"
            : "coverage";
      const key = `${evaluation.modelId}|${kind}|${check.pass ? "pass" : "fail"}`;
      const entry: AuditEntry = {
        sampleId: evaluation.sampleId,
        modelId: evaluation.modelId,
        checkId: check.id,
        checkName: check.name,
        judgeVerdict: check.pass ? "pass" : "fail",
        judgeReason: check.reason,
        evidence: check.evidence ?? "",
        groundTruth: evaluation.groundTruth,
        hypothesis: evaluation.hypothesis,
        humanVerdict: "",
      };
      strata.set(key, [...(strata.get(key) ?? []), entry]);
    }
  }

  // Round-robin over models first, then over that model's kind x verdict
  // strata. Cycling the flat stratum list instead would fill the sheet with
  // whichever models sort first and leave the last ones unrepresented.
  const models = [...new Set([...strata.keys()].map((k) => k.split("|")[0]!))].sort();
  const perModel = models
    .map((model, modelIdx) => ({
      strata: [...strata.entries()]
        .filter(([key]) => key.startsWith(`${model}|`))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, entries], idx) =>
          sampleWithoutReplacement(entries, entries.length, seed + modelIdx * 31 + idx),
        ),
      // Stagger where each model starts so a short sheet still covers every check
      // kind: otherwise all models spend their picks on the same first strata.
      cursor: modelIdx,
    }))
    .map((m) => ({ ...m, cursor: m.strata.length > 0 ? m.cursor % m.strata.length : 0 }));

  const picked: AuditEntry[] = [];
  let exhausted = false;
  while (picked.length < count && !exhausted) {
    exhausted = true;
    for (const model of perModel) {
      if (picked.length >= count) break;
      // Try each of this model's strata once, starting where we left off.
      for (let attempt = 0; attempt < model.strata.length; attempt++) {
        const stratum = model.strata[(model.cursor + attempt) % model.strata.length]!;
        const next = stratum.shift();
        if (next) {
          picked.push(next);
          model.cursor = (model.cursor + attempt + 1) % model.strata.length;
          exhausted = false;
          break;
        }
      }
    }
  }
  return picked;
};

export const scoreAuditWorksheet = (
  entries: readonly AuditEntry[],
): { agreement: number; kappa: number; n: number; unsure: number; disagreements: AuditEntry[] } => {
  const answered = entries.filter((e) => ["pass", "fail"].includes(e.humanVerdict.trim()));
  const pairs = answered.map((e) => [e.judgeVerdict, e.humanVerdict.trim()] as const);
  return {
    ...cohensKappa(pairs),
    unsure: entries.length - answered.length,
    disagreements: answered.filter((e) => e.humanVerdict.trim() !== e.judgeVerdict),
  };
};

export const writeConsistency = (runId: string, result: ConsistencyResult): string => {
  const out = path.resolve(process.cwd(), "runs", runId, "judge_consistency.json");
  fs.writeFileSync(out, JSON.stringify(result, null, 2), "utf-8");
  return out;
};
