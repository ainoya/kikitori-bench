import { Schema } from "effect";
import { EvaluationAxisSchema } from "./config.js";
import { TokenUsageSchema, ModelRunConditionSchema } from "./asr.js";
import { CategoryWeightsSchema } from "./config.js";

export const SeveritySchema = Schema.Literal("critical", "minor");

export type Severity = typeof SeveritySchema.Type;

export const BinaryCheckResultSchema = Schema.Struct({
  id: Schema.String,
  axis: EvaluationAxisSchema,
  name: Schema.String,
  pass: Schema.Boolean,
  reason: Schema.String,
  evidence: Schema.optional(Schema.String),
  /** Only critical defects reduce the score; minor ones are reported separately. */
  severity: Schema.optional(SeveritySchema)
});

export type BinaryCheckResult = typeof BinaryCheckResultSchema.Type;

export const CategoryScoreSchema = Schema.Struct({
  passed: Schema.Number,
  total: Schema.Number,
  scorePercent: Schema.Number
});

export type CategoryScore = typeof CategoryScoreSchema.Type;

export const SampleEvaluationSchema = Schema.Struct({
  sampleId: Schema.String,
  modelId: Schema.String,
  hypothesis: Schema.String,
  groundTruth: Schema.String,
  latencyMs: Schema.optional(Schema.Number),
  audioDurationMs: Schema.optional(Schema.Number),
  rtf: Schema.optional(Schema.Number),
  checks: Schema.Array(BinaryCheckResultSchema),
  categoryScores: Schema.Record({
    key: EvaluationAxisSchema,
    value: CategoryScoreSchema
  }),
  overallScore: Schema.Number, // 0 to 100
  /** Content asserted by the hypothesis that the ground truth does not support. */
  hallucinationsCritical: Schema.optional(Schema.Number),
  hallucinationsMinor: Schema.optional(Schema.Number),
  /** Length-normalised hallucination rate, so long clips are not penalised twice. */
  hallucinationsPerMinute: Schema.optional(Schema.Number),
  minorContradictions: Schema.optional(Schema.Number),
  /** Consumption of the ASR request that produced the hypothesis. */
  asrUsage: Schema.optional(TokenUsageSchema),
  asrCostUsd: Schema.optional(Schema.Number),
  /** True when asrCostUsd was derived from audio length instead of reported tokens. */
  asrCostEstimated: Schema.optional(Schema.Boolean),
  /** Consumption of the judge turn that produced the checks. */
  judgeUsage: Schema.optional(TokenUsageSchema),
  judgeCostUsd: Schema.optional(Schema.Number)
});

export type SampleEvaluation = typeof SampleEvaluationSchema.Type;

export const LeaderboardEntrySchema = Schema.Struct({
  modelId: Schema.String,
  displayName: Schema.String,
  overallScore: Schema.Number,
  categoryScores: Schema.Record({
    key: EvaluationAxisSchema,
    value: Schema.Number
  }),
  sampleCount: Schema.Number,
  averageLatencyMs: Schema.Number,
  averageRtf: Schema.optional(Schema.Number),
  asrCostUsd: Schema.optional(Schema.Number),
  judgeCostUsd: Schema.optional(Schema.Number),
  totalCostUsd: Schema.optional(Schema.Number)
});

export type LeaderboardEntry = typeof LeaderboardEntrySchema.Type;

/** Everything needed to reproduce a run: judge settings, weights, per-model request parameters. */
export const ExperimentConditionsSchema = Schema.Struct({
  judge: Schema.Struct({
    provider: Schema.String,
    model: Schema.String,
    endpoint: Schema.String,
    temperature: Schema.optional(Schema.Number)
  }),
  weights: CategoryWeightsSchema,
  sampleCount: Schema.Number,
  /** Duration cap applied when selecting samples, when one was used. */
  maxDurationSec: Schema.optional(Schema.Number),
  excludedByDuration: Schema.optional(Schema.Number),
  models: Schema.Array(ModelRunConditionSchema)
});

export type ExperimentConditions = typeof ExperimentConditionsSchema.Type;

export const ModelUsageSummarySchema = Schema.Struct({
  modelId: Schema.String,
  displayName: Schema.String,
  sampleCount: Schema.Number,
  audioSeconds: Schema.Number,
  asrUsage: TokenUsageSchema,
  asrCostUsd: Schema.optional(Schema.Number),
  asrCostEstimated: Schema.Boolean,
  judgeUsage: TokenUsageSchema,
  judgeCostUsd: Schema.optional(Schema.Number),
  totalCostUsd: Schema.optional(Schema.Number)
});

export type ModelUsageSummary = typeof ModelUsageSummarySchema.Type;

export const RunUsageSummarySchema = Schema.Struct({
  /** Price list version stamp: which config the costs were computed from. */
  judgeModel: Schema.String,
  perModel: Schema.Array(ModelUsageSummarySchema),
  totalAsrCostUsd: Schema.optional(Schema.Number),
  totalJudgeCostUsd: Schema.optional(Schema.Number),
  totalCostUsd: Schema.optional(Schema.Number)
});

export type RunUsageSummary = typeof RunUsageSummarySchema.Type;

/** Per-model reliability figures computed from the stored per-sample results. */
export const ModelAnalyticsSchema = Schema.Struct({
  modelId: Schema.String,
  displayName: Schema.String,
  overallScore: Schema.Number,
  ciLow: Schema.Number,
  ciHigh: Schema.Number,
  latencyP50Ms: Schema.Number,
  latencyP95Ms: Schema.Number,
  emptyOutputs: Schema.Number,
  /** Deterministic expected-term recall, independent of the LLM judge. */
  termsMatched: Schema.Number,
  termsTotal: Schema.Number,
  termRecallPercent: Schema.Number
});

export type ModelAnalytics = typeof ModelAnalyticsSchema.Type;

export const AxisComparisonSchema = Schema.Struct({
  axis: EvaluationAxisSchema,
  aOnly: Schema.Number,
  bOnly: Schema.Number,
  bothPass: Schema.Number,
  bothFail: Schema.Number,
  pValue: Schema.Number
});

export type AxisComparison = typeof AxisComparisonSchema.Type;

/** Rank-adjacent comparison: is model A really above model B, or is it noise? */
export const PairwiseComparisonSchema = Schema.Struct({
  a: Schema.String,
  b: Schema.String,
  meanDiff: Schema.Number,
  ciLow: Schema.Number,
  ciHigh: Schema.Number,
  /** Bonferroni-widened interval: the verdict to quote when scanning all pairs. */
  adjustedCiLow: Schema.Number,
  adjustedCiHigh: Schema.Number,
  significant: Schema.Boolean,
  significantAdjusted: Schema.Boolean,
  axes: Schema.Array(AxisComparisonSchema)
});

export type PairwiseComparison = typeof PairwiseComparisonSchema.Type;

/** Which samples actually discriminate between models. */
export const ItemAnalysisSchema = Schema.Struct({
  totalSamples: Schema.Number,
  allModelsFail: Schema.Array(Schema.String),
  allModelsPass: Schema.Array(Schema.String),
  discriminating: Schema.Number,
  /** Expected terms that every model missed - usually a dataset defect. */
  termsMissedByAll: Schema.Array(Schema.String),
  /** How much resolution each axis actually has on this dataset. */
  axisDiscrimination: Schema.Array(
    Schema.Struct({
      axis: EvaluationAxisSchema,
      allPass: Schema.Number,
      allFail: Schema.Number,
      discriminating: Schema.Number
    })
  )
});

export const RunAnalyticsSchema = Schema.Struct({
  bootstrapIterations: Schema.Number,
  models: Schema.Array(ModelAnalyticsSchema),
  pairwise: Schema.Array(PairwiseComparisonSchema),
  items: ItemAnalysisSchema
});

export type RunAnalytics = typeof RunAnalyticsSchema.Type;

export const BenchmarkReportSchema = Schema.Struct({
  runId: Schema.String,
  datasetName: Schema.String,
  timestamp: Schema.String,
  judgeModel: Schema.String,
  evaluations: Schema.Array(SampleEvaluationSchema),
  leaderboard: Schema.Array(LeaderboardEntrySchema),
  conditions: Schema.optional(ExperimentConditionsSchema),
  usageSummary: Schema.optional(RunUsageSummarySchema),
  analytics: Schema.optional(RunAnalyticsSchema)
});

export type BenchmarkReport = typeof BenchmarkReportSchema.Type;
