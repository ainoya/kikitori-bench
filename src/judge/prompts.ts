import type { DatasetItem } from "../schemas/dataset.js";

export interface JudgePromptInput {
  item: DatasetItem;
  hypothesis: string;
  modelId: string;
}

/**
 * The judge verdict is collected per claim - one entry per expected term, one
 * per key point, one per unsupported insertion - rather than as a single verdict
 * for the whole clip. A per-clip verdict saturates: on a 75-second recording any
 * single slip fails the sample and all models look identical.
 */
export const buildJudgePrompt = (input: JudgePromptInput): string => {
  const { item, hypothesis } = input;

  const keyPointsList =
    item.keyPoints.length > 0
      ? item.keyPoints.map((p, idx) => `- [${idx + 1}] "${p}"`).join("\n")
      : "(none specified)";

  return `You are an expert Speech-to-Text (ASR) evaluation judge for Japanese audio.
Judge the ASR "Hypothesis" against the "Ground Truth" claim by claim.

### Ground Truth
"""
${item.groundTruth}
"""

### ASR Hypothesis
"""
${hypothesis}
"""

### Key Points (propositions the transcript must convey)
${keyPointsList}

---

### What to decide

Proper nouns and numbers are scored separately by a deterministic tokeniser, so
do not report them here - judge only the propositions.

**1. Key points** - for every key point above, choose exactly one verdict:
- "present": the hypothesis conveys this proposition correctly.
- "missing": the hypothesis does not convey it at all.
- "contradicted": the hypothesis states something incompatible with it (a changed
  number, a flipped negation, a different subject or object, an opposite conclusion).

**2. Insertions** - list content the hypothesis asserts that the ground truth does
not support (fabricated words, invented facts, repeated loops). Do not list
ordinary disfluency or punctuation differences.

### Severity

Assign severity to every "contradicted" key point and every insertion:
- "critical": it changes what a reader would understand or act on - numbers,
  quantities, dates, proper nouns, negation or polarity, instructions, conclusions.
- "minor": wording, orthography, filler, or a paraphrase that leaves the meaning intact.

Only critical defects reduce the score, so be strict about the distinction.

---

### Output Format
Output strictly valid JSON, no markdown fences and no surrounding text:

{
  "keyPoints": [
    { "index": 1, "verdict": "present", "reason": "The hypothesis states the same proposition.", "evidence": "quoted excerpt" },
    { "index": 2, "verdict": "contradicted", "severity": "critical", "reason": "Version 1.5 became 3.5.", "evidence": "3.5フラッシュ" }
  ],
  "insertions": [
    { "text": "補助越し", "severity": "critical", "reason": "No counterpart anywhere in the ground truth." }
  ]
}

Use an empty array when a category has nothing to report.`;
};
