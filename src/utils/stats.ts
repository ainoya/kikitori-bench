/** Small statistics helpers used by the run analytics. */

const RNG_SEED = 20260907;

/** Deterministic PRNG so a report regenerated from the same data is identical. */
const makeRng = (seed = RNG_SEED) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};

export interface Interval {
  readonly mean: number;
  readonly low: number;
  readonly high: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Percentile bootstrap of the mean (values are per-sample scores). */
export const bootstrapMean = (
  values: readonly number[],
  iterations = 4000,
  alpha = 0.05,
): Interval => {
  if (values.length === 0) return { mean: 0, low: 0, high: 0 };
  const rng = makeRng();
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) {
      sum += values[Math.floor(rng() * values.length)] ?? 0;
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    mean: round1(mean),
    low: round1(means[Math.floor((alpha / 2) * iterations)] ?? mean),
    high: round1(means[Math.min(iterations - 1, Math.floor((1 - alpha / 2) * iterations))] ?? mean),
  };
};

/**
 * Paired bootstrap of the mean difference. Both models transcribe the same
 * clips, so resampling sample ids (not each model independently) cancels
 * per-clip difficulty and gives a much tighter interval.
 */
export const bootstrapPairedDiff = (
  pairs: ReadonlyArray<readonly [number, number]>,
  iterations = 4000,
  alpha = 0.05,
): Interval =>
  bootstrapMean(
    pairs.map(([a, b]) => a - b),
    iterations,
    alpha,
  );

const logFactorial = (n: number): number => {
  let acc = 0;
  for (let i = 2; i <= n; i++) acc += Math.log(i);
  return acc;
};

const binomialPmf = (k: number, n: number): number =>
  Math.exp(logFactorial(n) - logFactorial(k) - logFactorial(n - k) - n * Math.LN2);

/**
 * Exact (binomial) McNemar test for paired binary outcomes.
 * Only the discordant cells carry information: under the null the b/c split is
 * a fair coin, so the two-sided p is the tail probability of a split at least
 * this lopsided.
 */
export const mcnemarExact = (bOnlyA: number, cOnlyB: number): number => {
  const n = bOnlyA + cOnlyB;
  if (n === 0) return 1;
  const lower = Math.min(bOnlyA, cOnlyB);
  let tail = 0;
  for (let k = 0; k <= lower; k++) tail += binomialPmf(k, n);
  return Math.min(1, 2 * tail);
};

/** Nearest-rank percentile (p in 0..100). */
export const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
};

/**
 * Normalise Japanese text for deterministic term matching: width folding,
 * katakana to hiragana, and removal of spacing and punctuation that carry no
 * lexical meaning ("コーヒー" == "こーひー", "３．５" == "3.5").
 */
export const normalizeForMatch = (text: string): string =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s、。，．,.!?！？「」『』（）()・:;：；\-–—_"'`]/g, "");

/** Whether a hypothesis contains an expected term, ignoring the noise above. */
export const containsTerm = (hypothesis: string, term: string): boolean => {
  const needle = normalizeForMatch(term);
  return needle.length > 0 && normalizeForMatch(hypothesis).includes(needle);
};

/**
 * Cohen's kappa for two ratings of the same items: agreement above what the
 * two raters' marginals would produce by chance. 1 is perfect, 0 is chance.
 */
export const cohensKappa = (
  pairs: ReadonlyArray<readonly [string, string]>,
): { agreement: number; kappa: number; n: number } => {
  const n = pairs.length;
  if (n === 0) return { agreement: 0, kappa: 0, n: 0 };

  const observed = pairs.filter(([a, b]) => a === b).length / n;
  const categories = new Set(pairs.flatMap(([a, b]) => [a, b]));
  let expected = 0;
  for (const c of categories) {
    const pa = pairs.filter(([a]) => a === c).length / n;
    const pb = pairs.filter(([, b]) => b === c).length / n;
    expected += pa * pb;
  }
  const kappa = expected >= 1 ? 1 : (observed - expected) / (1 - expected);
  return {
    agreement: Math.round(observed * 1000) / 10,
    kappa: Math.round(kappa * 1000) / 1000,
    n,
  };
};

/** Deterministic subsample without replacement, so an audit is reproducible. */
export const sampleWithoutReplacement = <T>(
  items: readonly T[],
  count: number,
  seed: number,
): T[] => {
  const pool = [...items];
  let s = seed >>> 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const picked: T[] = [];
  while (picked.length < Math.min(count, items.length) && pool.length > 0) {
    const [item] = pool.splice(Math.floor(rng() * pool.length), 1);
    if (item !== undefined) picked.push(item);
  }
  return picked;
};
