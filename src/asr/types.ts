import { Effect } from "effect";
import { AsrExecutionError } from "../errors.js";
import type { TokenUsage } from "../schemas/asr.js";

export interface AsrAdapter {
  readonly modelId: string;
  readonly displayName: string;
  /** Provider family this adapter talks to (`gemini`, `groq`, `meta`, ...). */
  readonly provider: string;
  /** Resolved request parameters, recorded as the experiment condition of a run. */
  readonly parameters: Readonly<Record<string, unknown>>;
  transcribe(
    audioFullPath: string,
    sampleId: string,
  ): Effect.Effect<
    { hypothesis: string; latencyMs: number; usage?: TokenUsage },
    AsrExecutionError
  >;
}
