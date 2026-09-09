import { Effect } from "effect";
import type { AsrAdapter } from "./types.js";

export class MockAdapter implements AsrAdapter {
  readonly provider = "mock";

  constructor(
    public readonly modelId: string,
    public readonly displayName: string,
    private readonly mockHypothesis?: string,
  ) {}

  get parameters(): Readonly<Record<string, unknown>> {
    return { mockHypothesis: this.mockHypothesis ?? "(default)" };
  }

  transcribe(_audioFullPath: string, sampleId: string) {
    return Effect.sync(() => {
      return {
        hypothesis:
          this.mockHypothesis ??
          `This is a mock transcription result from [${this.displayName}] for sample (${sampleId}).`,
        latencyMs: 150,
      };
    });
  }
}
