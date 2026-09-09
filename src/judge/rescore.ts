import type { JudgeVerdict } from "./scoring.js";
import type { SampleEvaluation } from "../schemas/judge.js";
import type { DatasetItem } from "../schemas/dataset.js";

/**
 * Rebuild the judge's per-claim verdict from a stored evaluation's checks, so a
 * run scored under an older formula can be re-scored without paying the judge
 * again. Runs judged after checkpoints started carrying the raw verdict use
 * that instead; this is the fallback for older runs.
 */
export const verdictFromChecks = (
  evaluation: SampleEvaluation,
  item: DatasetItem
): JudgeVerdict => ({
  terms: item.expectedTerms.map((term) => ({
    term,
    present: evaluation.checks.find((c) => c.id === `term_${term}`)?.pass ?? false
  })),
  keyPoints: item.keyPoints.map((_, idx) => {
    const index = idx + 1;
    const coverage = evaluation.checks.find((c) => c.id === `point_${index}_coverage`);
    const fidelity = evaluation.checks.find((c) => c.id === `point_${index}_fidelity`);
    if (coverage?.pass === true) return { index, verdict: "present" as const };
    // Older runs emitted a fidelity check for every point; only a failing one
    // (or one explicitly marked minor) means the hypothesis asserted something.
    if (fidelity && (!fidelity.pass || fidelity.severity === "minor")) {
      return {
        index,
        verdict: "contradicted" as const,
        severity: (fidelity.severity ?? "critical") as "critical" | "minor"
      };
    }
    return { index, verdict: "missing" as const };
  }),
  insertions: evaluation.checks
    .filter((c) => c.id.startsWith("insertion_"))
    .map((c) => ({
      text: c.evidence ?? c.name,
      severity: (c.severity ?? "critical") as "critical" | "minor",
      ...(c.reason ? { reason: c.reason } : {})
    }))
});
