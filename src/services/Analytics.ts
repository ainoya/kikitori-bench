import type { AppConfig, EvaluationAxis } from "../schemas/config.js";
import type { DatasetItem } from "../schemas/dataset.js";
import type {
  AxisComparison,
  ModelAnalytics,
  PairwiseComparison,
  RunAnalytics,
  SampleEvaluation
} from "../schemas/judge.js";
import { CHECKED_AXES } from "../judge/scoring.js";
import { bootstrapMean, bootstrapPairedDiff, mcnemarExact, percentile } from "../utils/stats.js";

// F1 is derived from recall and precision, so a pass/fail agreement test on it
// would double-count the two axes it is made of.
const AXES: EvaluationAxis[] = [...CHECKED_AXES];

const BOOTSTRAP_ITERATIONS = 4000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Per-sample pass/fail for one axis: an axis passes when all its checks pass. */
const axisPassed = (evaluation: SampleEvaluation, axis: EvaluationAxis): boolean => {
  const score = evaluation.categoryScores[axis];
  return score !== undefined && score.total > 0 && score.passed === score.total;
};

/**
 * Reliability layer over a finished run: bootstrap intervals, rank-adjacent
 * paired comparisons, latency percentiles, deterministic term recall and an
 * item analysis that surfaces samples with no discriminating power.
 */
export const buildRunAnalytics = (
  evaluations: readonly SampleEvaluation[],
  _items: readonly DatasetItem[],
  config: AppConfig
): RunAnalytics => {
  const modelIds = Array.from(new Set(evaluations.map((e) => e.modelId)));
  const sampleIds = Array.from(new Set(evaluations.map((e) => e.sampleId)));

  const byModel = new Map<string, Map<string, SampleEvaluation>>();
  for (const e of evaluations) {
    const perSample = byModel.get(e.modelId) ?? new Map<string, SampleEvaluation>();
    perSample.set(e.sampleId, e);
    byModel.set(e.modelId, perSample);
  }

  const models: ModelAnalytics[] = modelIds.map((modelId) => {
    const perSample = byModel.get(modelId) ?? new Map();
    const evals = [...perSample.values()];
    const interval = bootstrapMean(
      evals.map((e) => e.overallScore),
      BOOTSTRAP_ITERATIONS
    );
    const latencies = evals.map((e) => e.latencyMs ?? 0);

    // Deterministic proper-noun agreement, independent of the LLM judge.
    let termsMatched = 0;
    let termsTotal = 0;
    for (const e of evals) {
      const score = e.categoryScores.proper_noun_f1;
      if (!score) continue;
      termsMatched += score.passed;
      termsTotal += score.total;
    }

    return {
      modelId,
      displayName: config.models[modelId]?.displayName ?? modelId,
      overallScore: interval.mean,
      ciLow: interval.low,
      ciHigh: interval.high,
      latencyP50Ms: Math.round(percentile(latencies, 50)),
      latencyP95Ms: Math.round(percentile(latencies, 95)),
      emptyOutputs: evals.filter((e) => e.hypothesis.trim().length === 0).length,
      termsMatched,
      termsTotal,
      termRecallPercent: termsTotal > 0 ? round1((termsMatched / termsTotal) * 100) : 0
    };
  });

  // Every pair, not just rank-adjacent ones: "A is not distinguishable from B"
  // and "B is not distinguishable from C" does not imply anything about A vs C,
  // and reading a chain of adjacent comparisons that way is the classic error.
  const ranked = [...models].sort((a, b) => b.overallScore - a.overallScore);
  const pairs: Array<[ModelAnalytics, ModelAnalytics]> = [];
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      pairs.push([ranked[i]!, ranked[j]!]);
    }
  }
  // Bonferroni: with this many comparisons a plain 95% interval would call
  // roughly one pair significant by chance alone.
  const adjustedAlpha = pairs.length > 0 ? 0.05 / pairs.length : 0.05;

  const pairwise: PairwiseComparison[] = [];
  for (const [a, b] of pairs) {
    const aEvals = byModel.get(a.modelId) ?? new Map();
    const bEvals = byModel.get(b.modelId) ?? new Map();
    const shared = sampleIds.filter((id) => aEvals.has(id) && bEvals.has(id));

    const paired = shared.map(
      (id) => [aEvals.get(id)!.overallScore, bEvals.get(id)!.overallScore] as const
    );
    const diff = bootstrapPairedDiff(paired, BOOTSTRAP_ITERATIONS);
    const adjusted = bootstrapPairedDiff(paired, BOOTSTRAP_ITERATIONS, adjustedAlpha);

    const axes: AxisComparison[] = AXES.map((axis) => {
      let aOnly = 0;
      let bOnly = 0;
      let bothPass = 0;
      let bothFail = 0;
      for (const id of shared) {
        const pa = axisPassed(aEvals.get(id)!, axis);
        const pb = axisPassed(bEvals.get(id)!, axis);
        if (pa && pb) bothPass += 1;
        else if (pa) aOnly += 1;
        else if (pb) bOnly += 1;
        else bothFail += 1;
      }
      return {
        axis,
        aOnly,
        bOnly,
        bothPass,
        bothFail,
        pValue: Math.round(mcnemarExact(aOnly, bOnly) * 1000) / 1000
      };
    });

    pairwise.push({
      a: a.modelId,
      b: b.modelId,
      meanDiff: diff.mean,
      ciLow: diff.low,
      ciHigh: diff.high,
      adjustedCiLow: adjusted.low,
      adjustedCiHigh: adjusted.high,
      significant: diff.low > 0 || diff.high < 0,
      significantAdjusted: adjusted.low > 0 || adjusted.high < 0,
      axes
    });
  }

  const allModelsFail: string[] = [];
  const allModelsPass: string[] = [];
  for (const id of sampleIds) {
    const scores = modelIds
      .map((m) => byModel.get(m)?.get(id)?.overallScore)
      .filter((s): s is number => s !== undefined);
    if (scores.length === 0) continue;
    if (scores.every((s) => s === 0)) allModelsFail.push(id);
    if (scores.every((s) => s === 100)) allModelsPass.push(id);
  }

  // Proper nouns no model recovered: usually an unusual name, sometimes a
  // defect in the ground truth itself.
  const termsMissedByAll: string[] = [];
  for (const id of sampleIds) {
    const seen = modelIds
      .map((m) => byModel.get(m)?.get(id))
      .filter((e): e is SampleEvaluation => e !== undefined);
    if (seen.length === 0) continue;
    const missedEverywhere = seen
      .map((e) => new Set(e.checks.filter((c) => c.id.startsWith("proper_missed_")).map((c) => c.id)))
      .reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))), new Set(seen[0]!.checks.filter((c) => c.id.startsWith("proper_missed_")).map((c) => c.id)));
    for (const id2 of missedEverywhere) termsMissedByAll.push(id2.replace("proper_missed_", ""));
  }

  // An axis only informs the ranking on samples where models disagree; an axis
  // that every model fails (or passes) everywhere is saturated, not selective.
  const axisDiscrimination = AXES.map((axis) => {
    let allPass = 0;
    let allFail = 0;
    for (const id of sampleIds) {
      const verdicts = modelIds
        .map((m) => byModel.get(m)?.get(id))
        .filter((e): e is SampleEvaluation => e !== undefined)
        .map((e) => axisPassed(e, axis));
      if (verdicts.length === 0) continue;
      if (verdicts.every((v) => v)) allPass += 1;
      else if (verdicts.every((v) => !v)) allFail += 1;
    }
    return {
      axis,
      allPass,
      allFail,
      discriminating: sampleIds.length - allPass - allFail
    };
  });

  return {
    bootstrapIterations: BOOTSTRAP_ITERATIONS,
    models,
    pairwise,
    items: {
      totalSamples: sampleIds.length,
      allModelsFail,
      allModelsPass,
      discriminating: sampleIds.length - allModelsFail.length - allModelsPass.length,
      termsMissedByAll: Array.from(new Set(termsMissedByAll)),
      axisDiscrimination
    }
  };
};
