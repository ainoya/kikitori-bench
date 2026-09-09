import { Effect, Schema } from "effect";
import type { CodexClient, CodexGenerateResult } from "./codex-client.js";
import { JudgeVerdictSchema, type JudgeVerdict } from "./scoring.js";
import { JudgeEvaluationError } from "../errors.js";
import type { DatasetItem } from "../schemas/dataset.js";

export interface JudgeOnceInput {
  client: CodexClient;
  judgeModel: string;
  temperature?: number;
  prompt: string;
  item: DatasetItem;
  modelId: string;
}

export interface JudgeOnceResult {
  judgeResponse: CodexGenerateResult;
  verdict: JudgeVerdict;
}

/**
 * One judge turn plus JSON parse - the unit that gets retried. A malformed
 * reply is a transient model glitch, so it must be retried together with the
 * call that produced it rather than failing the run.
 */
export const judgeOnce = (input: JudgeOnceInput) =>
  Effect.gen(function* () {
    const judgeResponse = yield* input.client.generate({
      model: input.judgeModel,
      prompt: input.prompt,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {})
    });

    // Strip a markdown code fence if the judge wrapped its JSON in one.
    let cleaned = judgeResponse.text.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    const verdict = yield* Effect.try({
      try: () => {
        const decoded = Schema.decodeUnknownEither(JudgeVerdictSchema)(JSON.parse(cleaned));
        if (decoded._tag === "Left") {
          throw new Error(`Invalid judge verdict structure: ${JSON.stringify(decoded.left)}`);
        }
        return decoded.right;
      },
      catch: (parseErr) =>
        new JudgeEvaluationError({
          sampleId: input.item.id,
          modelId: input.modelId,
          message: `Failed to parse judge JSON response: ${String(parseErr)}\nRaw output was: ${judgeResponse.text.slice(0, 2000)}`,
          cause: parseErr
        })
    });

    return { judgeResponse, verdict } satisfies JudgeOnceResult;
  });
