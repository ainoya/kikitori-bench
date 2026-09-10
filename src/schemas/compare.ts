import { Schema } from "effect";

/**
 * Shapes served to the side-by-side comparison UI. They are derived views over
 * a stored run plus the dataset manifest: the UI never reads `runs/` itself,
 * so the merge of hypothesis, ground truth and judge score happens once here.
 */

export const RunSummarySchema = Schema.Struct({
  runId: Schema.String,
  datasetName: Schema.String,
  timestamp: Schema.String,
  modelIds: Schema.Array(Schema.String),
  sampleCount: Schema.Number,
  /** Whether an `evaluation_report.json` sits next to the ASR results. */
  evaluated: Schema.Boolean,
});

export type RunSummary = typeof RunSummarySchema.Type;

export const CompareModelSchema = Schema.Struct({
  modelId: Schema.String,
  displayName: Schema.String,
});

export type CompareModel = typeof CompareModelSchema.Type;

export const CompareHypothesisSchema = Schema.Struct({
  modelId: Schema.String,
  hypothesis: Schema.String,
  latencyMs: Schema.optional(Schema.Number),
  audioDurationMs: Schema.optional(Schema.Number),
  rtf: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  /** Present only when the run has been judged. */
  overallScore: Schema.optional(Schema.Number),
});

export type CompareHypothesis = typeof CompareHypothesisSchema.Type;

export const CompareSampleSchema = Schema.Struct({
  sampleId: Schema.String,
  groundTruth: Schema.String,
  expectedTerms: Schema.Array(Schema.String),
  /** Relative to the dataset dir; absent when the manifest has no such item. */
  audioPath: Schema.optional(Schema.String),
  durationSec: Schema.optional(Schema.Number),
  verified: Schema.Boolean,
  hypotheses: Schema.Array(CompareHypothesisSchema),
});

export type CompareSample = typeof CompareSampleSchema.Type;

export const ComparisonViewSchema = Schema.Struct({
  /**
   * More than one when runs are merged. A model is rarely benchmarked in a
   * single run - a provider added later gets its own run over the same
   * samples - so the view that answers "how do all of them compare" has to
   * stitch those runs back together.
   */
  runIds: Schema.Array(Schema.String),
  datasetName: Schema.String,
  /** Newest timestamp among the merged runs. */
  timestamp: Schema.String,
  evaluated: Schema.Boolean,
  models: Schema.Array(CompareModelSchema),
  samples: Schema.Array(CompareSampleSchema),
});

export type ComparisonView = typeof ComparisonViewSchema.Type;
