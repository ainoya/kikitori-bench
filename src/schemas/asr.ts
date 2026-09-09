import { Schema } from "effect";

export const AsrRequestSchema = Schema.Struct({
  sampleId: Schema.String,
  audioPath: Schema.String,
  modelId: Schema.String,
});

export type AsrRequest = typeof AsrRequestSchema.Type;

/**
 * Token / audio consumption reported by a provider for a single request.
 * Every field is optional because providers expose different subsets.
 */
export const TokenUsageSchema = Schema.Struct({
  inputTokens: Schema.optional(Schema.Number),
  audioInputTokens: Schema.optional(Schema.Number),
  textInputTokens: Schema.optional(Schema.Number),
  cachedInputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  reasoningOutputTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
  billedAudioSeconds: Schema.optional(Schema.Number),
});

export type TokenUsage = typeof TokenUsageSchema.Type;

export const AsrResultSchema = Schema.Struct({
  sampleId: Schema.String,
  modelId: Schema.String,
  hypothesis: Schema.String,
  latencyMs: Schema.Number,
  audioDurationMs: Schema.optional(Schema.Number),
  rtf: Schema.optional(Schema.Number),
  timestamp: Schema.String,
  usage: Schema.optional(TokenUsageSchema),
  error: Schema.optional(Schema.String),
});

export type AsrResult = typeof AsrResultSchema.Type;

/** Resolved request parameters an adapter used for a run, for reproducibility. */
export const ModelRunConditionSchema = Schema.Struct({
  modelId: Schema.String,
  displayName: Schema.String,
  provider: Schema.String,
  parameters: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export type ModelRunCondition = typeof ModelRunConditionSchema.Type;

export const AsrBatchRunSchema = Schema.Struct({
  runId: Schema.String,
  datasetName: Schema.String,
  timestamp: Schema.String,
  models: Schema.Array(Schema.String),
  conditions: Schema.optional(Schema.Array(ModelRunConditionSchema)),
  results: Schema.Array(AsrResultSchema),
});

export type AsrBatchRun = typeof AsrBatchRunSchema.Type;
