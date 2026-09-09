import { Schema } from "effect";
import type { CategoryWeights, EvaluationAxis } from "../schemas/config.js";
import type { DatasetItem } from "../schemas/dataset.js";
import type { BinaryCheckResult, CategoryScore } from "../schemas/judge.js";
import type { LexicalScore } from "./lexical.js";

export const EVALUATION_AXES = [
  "proper_noun_f1",
  "proposition_recall",
  "proposition_precision",
  "proposition_f1"
] as const satisfies readonly EvaluationAxis[];

/** Axes backed by individual pass/fail checks (the F1 axes are derived). */
export const CHECKED_AXES = [
  "proposition_recall",
  "proposition_precision"
] as const satisfies readonly EvaluationAxis[];

/** Equal weight on omissions and fabrications. */
export const DEFAULT_F_BETA = 1;

export const JudgeVerdictSchema = Schema.Struct({
  terms: Schema.optionalWith(
    Schema.Array(
      Schema.Struct({
        term: Schema.String,
        present: Schema.Boolean,
        reason: Schema.optional(Schema.String),
        evidence: Schema.optional(Schema.String)
      })
    ),
    { default: () => [] }
  ),
  keyPoints: Schema.optionalWith(
    Schema.Array(
      Schema.Struct({
        index: Schema.Number,
        verdict: Schema.Literal("present", "missing", "contradicted"),
        severity: Schema.optional(Schema.Literal("critical", "minor")),
        reason: Schema.optional(Schema.String),
        evidence: Schema.optional(Schema.String)
      })
    ),
    { default: () => [] }
  ),
  insertions: Schema.optionalWith(
    Schema.Array(
      Schema.Struct({
        text: Schema.String,
        severity: Schema.optional(Schema.Literal("critical", "minor")),
        reason: Schema.optional(Schema.String)
      })
    ),
    { default: () => [] }
  )
});

export type JudgeVerdict = typeof JudgeVerdictSchema.Type;

export interface ScoreVerdictInput {
  verdict: JudgeVerdict;
  item: DatasetItem;
  audioDurationMs: number;
  weights: CategoryWeights;
  fBeta: number;
  /** Deterministic proper-noun score for this hypothesis. */
  lexical: LexicalScore;
}

export interface ScoredVerdict {
  checks: BinaryCheckResult[];
  categoryScores: Record<EvaluationAxis, CategoryScore>;
  overallScore: number;
  hallucinationsCritical: number;
  hallucinationsMinor: number;
  hallucinationsPerMinute: number;
  minorContradictions: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const rate = (passed: number, total: number): CategoryScore => ({
  passed,
  total,
  // A sample with no items of a kind cannot lose points for that axis.
  scorePercent: total > 0 ? round1((passed / total) * 100) : 100
});

/**
 * Turn a claim-level judge verdict into the four axis scores.
 *
 * Terms, coverage and fidelity are item-level rates, so their resolution grows
 * with the number of claims in a sample instead of collapsing to a single
 * pass/fail. Hallucination is a per-minute rate, which keeps a long recording
 * from being penalised simply for being long.
 */
export const scoreVerdict = (input: ScoreVerdictInput): ScoredVerdict => {
  const { verdict, item, audioDurationMs, weights, fBeta, lexical } = input;
  const checks: BinaryCheckResult[] = [];

  // --- proper nouns: measured deterministically, not by the judge ---------
  for (const token of lexical.missed) {
    checks.push({
      id: `proper_missed_${token}`,
      axis: "proper_noun_f1",
      name: `Proper noun missed: ${token}`,
      pass: false,
      reason: "Present in the ground truth, absent from the hypothesis."
    });
  }
  for (const token of lexical.fabricated) {
    checks.push({
      id: `proper_fabricated_${token}`,
      axis: "proper_noun_f1",
      name: `Proper noun fabricated: ${token}`,
      pass: false,
      reason: "Asserted by the hypothesis with no counterpart in the ground truth.",
      evidence: token
    });
  }

  // --- key points: recall on one side, precision on the other -------------
  const keyPoints = verdict.keyPoints.filter((k) => k.index >= 1);
  let present = 0;
  let criticalContradictions = 0;
  let minorContradictions = 0;

  for (const k of keyPoints) {
    const label = item.keyPoints[k.index - 1] ?? `Key point ${k.index}`;
    const isPresent = k.verdict === "present";
    const isCriticalContradiction = k.verdict === "contradicted" && k.severity !== "minor";
    if (isPresent) present += 1;
    if (k.verdict === "contradicted") {
      if (isCriticalContradiction) criticalContradictions += 1;
      else minorContradictions += 1;
    }

    checks.push({
      id: `point_${k.index}_coverage`,
      axis: "proposition_recall",
      name: `Key point ${k.index}: ${label}`,
      pass: isPresent,
      reason: k.reason ?? `Verdict: ${k.verdict}.`,
      ...(k.evidence ? { evidence: k.evidence } : {}),
      ...(k.severity ? { severity: k.severity } : {})
    });

    // A contradiction is a false assertion, so it belongs to precision.
    if (k.verdict === "contradicted") {
      checks.push({
        id: `point_${k.index}_fidelity`,
        axis: "proposition_precision",
        name: `Key point ${k.index}: contradicted`,
        pass: !isCriticalContradiction,
        reason: k.reason ?? "The hypothesis states something incompatible with this proposition.",
        ...(k.evidence ? { evidence: k.evidence } : {}),
        ...(k.severity ? { severity: k.severity } : {})
      });
    }
  }

  // --- insertions: assertions with no counterpart in the ground truth -----
  const insertions = verdict.insertions.filter((i) => i.text.trim().length > 0);
  const hallucinationsCritical = insertions.filter((i) => i.severity !== "minor").length;
  const hallucinationsMinor = insertions.length - hallucinationsCritical;
  const minutes = audioDurationMs > 0 ? audioDurationMs / 60_000 : 0;
  const hallucinationsPerMinute =
    minutes > 0 ? Math.round((hallucinationsCritical / minutes) * 1000) / 1000 : 0;

  for (const ins of insertions) {
    checks.push({
      id: `insertion_${checks.length}`,
      axis: "proposition_precision",
      name: `Insertion: ${ins.text}`,
      pass: false,
      reason: ins.reason ?? "Content not supported by the ground truth.",
      evidence: ins.text,
      severity: ins.severity ?? "critical"
    });
  }

  // Recall over the propositions the speaker actually made; precision over the
  // assertions the hypothesis makes. Both denominators are counts of claims,
  // so neither depends on clip length or on the model's punctuation style.
  const falseAssertions = criticalContradictions + hallucinationsCritical;
  const recall = rate(present, keyPoints.length);
  const precision = rate(present, present + falseAssertions);

  const r = recall.scorePercent / 100;
  const p = precision.scorePercent / 100;
  const beta2 = fBeta * fBeta;
  const f1 =
    p + r > 0 && beta2 * p + r > 0 ? ((1 + beta2) * p * r) / (beta2 * p + r) : 0;

  const categoryScores: Record<EvaluationAxis, CategoryScore> = {
    proper_noun_f1: {
      passed: lexical.referenceTokens.length - lexical.missed.length,
      total: lexical.referenceTokens.length,
      scorePercent: lexical.f1
    },
    proposition_recall: recall,
    proposition_precision: precision,
    proposition_f1: {
      passed: present,
      total: keyPoints.length + falseAssertions,
      scorePercent: round1(f1 * 100)
    }
  };

  // A sample with no proper nouns on either side has nothing to measure on that
  // axis. Scoring it as a perfect 100 would hand 30% of the score to a
  // transcript that got everything wrong, so the weight is redistributed to the
  // propositions instead - 25 of 129 samples in this corpus are like that.
  const properNounApplicable =
    lexical.referenceTokens.length > 0 || lexical.hypothesisTokens.length > 0;
  const overallScore = properNounApplicable
    ? round1(
        categoryScores.proper_noun_f1.scorePercent * weights.proper_noun_f1 +
          categoryScores.proposition_f1.scorePercent * weights.proposition_quality
      )
    : round1(categoryScores.proposition_f1.scorePercent);

  return {
    checks,
    categoryScores,
    overallScore,
    hallucinationsCritical,
    hallucinationsMinor,
    hallucinationsPerMinute,
    minorContradictions
  };
};
