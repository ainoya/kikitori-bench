import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Effect } from "effect";
import type { AsrAdapter } from "./types.js";
import { AsrExecutionError } from "../errors.js";

const execAsync = promisify(exec);

export class CustomCommandAdapter implements AsrAdapter {
  readonly provider = "custom-command";

  constructor(
    public readonly modelId: string,
    public readonly displayName: string,
    private readonly commandTemplate: string,
  ) {}

  get parameters(): Readonly<Record<string, unknown>> {
    return { command: this.commandTemplate };
  }

  transcribe(audioFullPath: string, sampleId: string) {
    return Effect.gen(this, function* () {
      const command = this.commandTemplate
        .replaceAll("{audio_path}", `"${audioFullPath}"`)
        .replaceAll("{sample_id}", `"${sampleId}"`);

      const startTime = Date.now();

      const result = yield* Effect.tryPromise({
        try: async () => {
          return await execAsync(command);
        },
        catch: (err) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Custom command failed [${command}]: ${String(err)}`,
            cause: err,
          }),
      });

      const latencyMs = Date.now() - startTime;
      const hypothesis = result.stdout.trim();

      return { hypothesis, latencyMs };
    });
  }
}
