import { Schema } from "effect";

/**
 * The four measured quantities. Every one is item-level (per expected term, per
 * key point, per hallucinated insertion) so that resolution does not collapse
 * on long clips the way a single per-sample verdict does.
 */
export const EvaluationAxisSchema = Schema.Literal(
  "proper_noun_f1",
  "proposition_recall",
  "proposition_precision",
  "proposition_f1",
);

export type EvaluationAxis = typeof EvaluationAxisSchema.Type;

/**
 * The overall score is not a plain weighted mean: recall and precision are
 * combined with F-beta first, so a model cannot buy a good score by
 * transcribing almost nothing (perfect precision, no recall).
 */
export const CategoryWeightsSchema = Schema.Struct({
  proper_noun_f1: Schema.Number,
  proposition_quality: Schema.Number,
});

export type CategoryWeights = typeof CategoryWeightsSchema.Type;

/**
 * Price list for a single model. Rates are USD.
 * Providers bill either per token (Gemini-style) or per hour of audio
 * (Groq / Meta / xAI STT), so both shapes are supported.
 */
/**
 * Request parameters that define the experiment condition for an ASR model.
 * Each adapter applies the subset its provider supports and records the
 * resolved values in the run manifest.
 */
export const AsrModelOptionsSchema = Schema.Struct({
  /** Language hint (`ja`, `en`, ...). */
  language: Schema.optional(Schema.String),
  /** Transcription instruction / biasing prompt. */
  prompt: Schema.optional(Schema.String),
  temperature: Schema.optional(Schema.Number),
  /** Gemini generationConfig.thinkingConfig.thinkingBudget (0 disables thinking). */
  thinkingBudget: Schema.optional(Schema.Number),
  /** Gemini 3.x generationConfig.thinkingConfig.thinkingLevel ("low" | "medium" | "high"). */
  thinkingLevel: Schema.optional(Schema.String),
  maxOutputTokens: Schema.optional(Schema.Number),
  /** OpenAI/Groq response_format (`json`, `verbose_json`, `text`). */
  responseFormat: Schema.optional(Schema.String),
  /** Meta Muse mode (`DIARIZATION`, `ENDPOINTING`, `PUSH_TO_TALK`). */
  mode: Schema.optional(Schema.String),
  /** Meta Muse audioEncoding (`WAV`, `PCM_16KHZ`, `PCM_24KHZ`). */
  audioEncoding: Schema.optional(Schema.String),
  /** Meta Muse languageBias, e.g. ["Japanese"]. */
  languageBias: Schema.optional(Schema.Array(Schema.String)),
  /** Keyword / vocabulary biasing list. */
  keywords: Schema.optional(Schema.Array(Schema.String)),
});

export type AsrModelOptions = typeof AsrModelOptionsSchema.Type;

export const ModelPricingSchema = Schema.Struct({
  inputPerMTok: Schema.optional(Schema.Number),
  cachedInputPerMTok: Schema.optional(Schema.Number),
  audioInputPerMTok: Schema.optional(Schema.Number),
  outputPerMTok: Schema.optional(Schema.Number),
  perAudioHour: Schema.optional(Schema.Number),
  /** Minimum billed audio length per request (Groq bills a 10s minimum). */
  minBillableSeconds: Schema.optional(Schema.Number),
  /** Fallback ratios used to estimate cost when the API returns no token counts. */
  estimateAudioTokensPerSecond: Schema.optional(Schema.Number),
  estimateOutputTokensPerMinute: Schema.optional(Schema.Number),
});

export type ModelPricing = typeof ModelPricingSchema.Type;

export const JudgeConfigSchema = Schema.Struct({
  provider: Schema.Literal("codex", "mock"),
  model: Schema.String,
  endpoint: Schema.String,
  stdioCommand: Schema.optional(Schema.String),
  temperature: Schema.optional(Schema.Number),
  concurrency: Schema.optional(Schema.Number),
  /** Per-turn timeout in ms; one slow turn must not abort a long run. */
  timeoutMs: Schema.optional(Schema.Number),
  /** Extra attempts for a judge turn that times out or drops its connection. */
  retries: Schema.optional(Schema.Number),
  pricing: Schema.optional(ModelPricingSchema),
});

export type JudgeConfig = typeof JudgeConfigSchema.Type;

export const AsrModelConfigSchema = Schema.Struct({
  type: Schema.Literal(
    "xai",
    "gemini",
    "whisper",
    "groq",
    "meta",
    "custom-http",
    "custom-command",
    "mock",
  ),
  model: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  endpoint: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
  options: Schema.optional(AsrModelOptionsSchema),
  pricing: Schema.optional(ModelPricingSchema),
});

export type AsrModelConfig = typeof AsrModelConfigSchema.Type;

export const ScoringConfigSchema = Schema.Struct({
  /**
   * F-beta weighting of proposition recall against precision.
   * 1 treats an omission and a fabrication as equally bad; below 1 weights
   * precision (fabrication is worse), above 1 weights recall.
   */
  fBeta: Schema.optional(Schema.Number),
});

export type ScoringConfig = typeof ScoringConfigSchema.Type;

export const ReviewConfigSchema = Schema.Struct({
  port: Schema.Number,
});

export type ReviewConfig = typeof ReviewConfigSchema.Type;

export const AppConfigSchema = Schema.Struct({
  judge: JudgeConfigSchema,
  weights: CategoryWeightsSchema,
  models: Schema.Record({ key: Schema.String, value: AsrModelConfigSchema }),
  scoring: Schema.optional(ScoringConfigSchema),
  review: ReviewConfigSchema,
});

export type AppConfig = typeof AppConfigSchema.Type;
