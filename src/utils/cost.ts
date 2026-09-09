import type { AppConfig, ModelPricing } from "../schemas/config.js";
import type { TokenUsage } from "../schemas/asr.js";
import type { ModelUsageSummary, RunUsageSummary, SampleEvaluation } from "../schemas/judge.js";

const PER_MILLION = 1_000_000;

export interface CostBreakdown {
  /** USD cost for the request. */
  costUsd: number;
  /** True when token counts were unavailable and the cost was derived from audio length. */
  estimated: boolean;
}

const round6 = (n: number): number => Math.round(n * 1_000_000) / 1_000_000;

/**
 * Cost of a single ASR request.
 * Duration-billed providers (Groq / Meta / xAI) use `perAudioHour`; token-billed
 * providers (Gemini) use the per-million-token rates. When a token-billed provider
 * returned no usage, the cost is estimated from audio length via the estimate ratios.
 */
export const computeAsrCost = (
  usage: TokenUsage | undefined,
  audioDurationMs: number | undefined,
  pricing: ModelPricing | undefined,
  /** Whether the request produced a transcript; an empty one bills no output. */
  producedOutput = true,
): CostBreakdown | undefined => {
  if (!pricing) return undefined;

  if (pricing.perAudioHour !== undefined) {
    const seconds = usage?.billedAudioSeconds ?? (audioDurationMs ?? 0) / 1000;
    if (seconds <= 0) return undefined;
    const billedSeconds = Math.max(seconds, pricing.minBillableSeconds ?? 0);
    return { costUsd: round6((billedSeconds / 3600) * pricing.perAudioHour), estimated: false };
  }

  const hasTokenCounts =
    usage !== undefined &&
    (usage.inputTokens !== undefined ||
      usage.audioInputTokens !== undefined ||
      usage.outputTokens !== undefined);

  if (hasTokenCounts) {
    // Some transcription models report prompt tokens only; fall back to the
    // documented output ratio so the output side is not silently free.
    const missingOutput = (usage.outputTokens ?? 0) === 0;
    const canEstimateOutput =
      missingOutput &&
      producedOutput &&
      pricing.estimateOutputTokensPerMinute !== undefined &&
      audioDurationMs !== undefined &&
      audioDurationMs > 0;

    const effectiveUsage: TokenUsage = canEstimateOutput
      ? {
          ...usage,
          outputTokens: (audioDurationMs / 60_000) * (pricing.estimateOutputTokensPerMinute ?? 0),
        }
      : usage;

    return { costUsd: round6(tokenCost(effectiveUsage, pricing)), estimated: canEstimateOutput };
  }

  // No usage reported: estimate token counts from the audio length.
  if (
    audioDurationMs !== undefined &&
    audioDurationMs > 0 &&
    pricing.estimateAudioTokensPerSecond !== undefined
  ) {
    const outputRatio = producedOutput ? (pricing.estimateOutputTokensPerMinute ?? 0) : 0;
    const seconds = audioDurationMs / 1000;
    const estimated: TokenUsage = {
      audioInputTokens: seconds * pricing.estimateAudioTokensPerSecond,
      outputTokens: (seconds / 60) * outputRatio,
    };
    return { costUsd: round6(tokenCost(estimated, pricing)), estimated: true };
  }

  return undefined;
};

/** Cost of a single judge turn, always token-billed. */
export const computeJudgeCost = (
  usage: TokenUsage | undefined,
  pricing: ModelPricing | undefined,
): CostBreakdown | undefined => {
  if (!pricing || !usage) return undefined;
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.cachedInputTokens === undefined
  ) {
    return undefined;
  }
  return { costUsd: round6(tokenCost(usage, pricing)), estimated: false };
};

const tokenCost = (usage: TokenUsage, pricing: ModelPricing): number => {
  const audioInput = usage.audioInputTokens ?? 0;
  const cachedInput = usage.cachedInputTokens ?? 0;
  // `inputTokens` from providers is the full prompt total; subtract the parts
  // that are billed at their own rate so nothing is counted twice.
  const totalInput = usage.inputTokens ?? audioInput + (usage.textInputTokens ?? 0);
  const plainInput = Math.max(totalInput - audioInput - cachedInput, 0);

  const audioRate = pricing.audioInputPerMTok ?? pricing.inputPerMTok ?? 0;
  const inputRate = pricing.inputPerMTok ?? 0;
  const cachedRate = pricing.cachedInputPerMTok ?? inputRate;
  const outputRate = pricing.outputPerMTok ?? 0;

  return (
    (audioInput * audioRate +
      plainInput * inputRate +
      cachedInput * cachedRate +
      (usage.outputTokens ?? 0) * outputRate) /
    PER_MILLION
  );
};

/** Element-wise sum of usage records; undefined fields are treated as absent, not zero. */
export const sumUsage = (entries: ReadonlyArray<TokenUsage | undefined>): TokenUsage => {
  const acc: {
    -readonly [K in keyof TokenUsage]: number | undefined;
  } = {};
  const keys = [
    "inputTokens",
    "audioInputTokens",
    "textInputTokens",
    "cachedInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens",
    "billedAudioSeconds",
  ] as const;

  for (const entry of entries) {
    if (!entry) continue;
    for (const key of keys) {
      const value = entry[key];
      if (value === undefined) continue;
      acc[key] = (acc[key] ?? 0) + value;
    }
  }
  return acc;
};

/**
 * Aggregate per-model token/cost totals for a finished run.
 * Costs are recomputed from the stored usage and the current price list, so an
 * older run can be re-summarised after prices in the config change.
 */
export const buildRunUsageSummary = (
  evaluations: readonly SampleEvaluation[],
  config: AppConfig,
  judgeModel: string,
): RunUsageSummary => {
  const modelIds = Array.from(new Set(evaluations.map((e) => e.modelId)));
  const perModel: ModelUsageSummary[] = [];

  for (const modelId of modelIds) {
    const modelEvals = evaluations.filter((e) => e.modelId === modelId);
    const asrPricing = config.models[modelId]?.pricing;
    const judgePricing = config.judge.pricing;

    const asrCosts = modelEvals.map((e) =>
      computeAsrCost(e.asrUsage, e.audioDurationMs, asrPricing, e.hypothesis.trim().length > 0),
    );
    const judgeCosts = modelEvals.map((e) => computeJudgeCost(e.judgeUsage, judgePricing));

    const asrCostUsd = sumCosts(asrCosts);
    const judgeCostUsd = sumCosts(judgeCosts);

    perModel.push({
      modelId,
      displayName: config.models[modelId]?.displayName ?? modelId,
      sampleCount: modelEvals.length,
      audioSeconds:
        Math.round((modelEvals.reduce((acc, e) => acc + (e.audioDurationMs ?? 0), 0) / 1000) * 10) /
        10,
      asrUsage: sumUsage(modelEvals.map((e) => e.asrUsage)),
      asrCostUsd,
      asrCostEstimated: asrCosts.some((c) => c?.estimated === true),
      judgeUsage: sumUsage(modelEvals.map((e) => e.judgeUsage)),
      judgeCostUsd,
      totalCostUsd: addOptional(asrCostUsd, judgeCostUsd),
    });
  }

  const totalAsrCostUsd = sumOptional(perModel.map((m) => m.asrCostUsd));
  const totalJudgeCostUsd = sumOptional(perModel.map((m) => m.judgeCostUsd));

  return {
    judgeModel,
    perModel,
    totalAsrCostUsd,
    totalJudgeCostUsd,
    totalCostUsd: addOptional(totalAsrCostUsd, totalJudgeCostUsd),
  };
};

const sumCosts = (costs: ReadonlyArray<CostBreakdown | undefined>): number | undefined =>
  sumOptional(costs.map((c) => c?.costUsd));

const sumOptional = (values: ReadonlyArray<number | undefined>): number | undefined => {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length > 0 ? round6(known.reduce((a, b) => a + b, 0)) : undefined;
};

const addOptional = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined && b === undefined ? undefined : round6((a ?? 0) + (b ?? 0));
