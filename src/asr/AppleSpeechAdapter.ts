import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Effect, Schema } from "effect";
import type { AsrAdapter } from "./types.js";
import { AsrExecutionError } from "../errors.js";
import type { AsrModelOptions } from "../schemas/config.js";

const execFileAsync = promisify(execFile);

const AppleHelperOutputSchema = Schema.Struct({
  transcript: Schema.String,
  transcriptionMs: Schema.Number,
});

/** SpeechAnalyzer conservatively limits simultaneous sessions on one device. */
class SerialGate {
  private tail: Promise<void> = Promise.resolve();

  run<A>(task: () => Promise<A>): Promise<A> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(task).finally(release);
  }
}

const gate = new SerialGate();

export class AppleSpeechAdapter implements AsrAdapter {
  readonly provider = "apple";

  constructor(
    public readonly modelId: string,
    public readonly displayName: string,
    private readonly engine = "speech-transcriber",
    private readonly options: AsrModelOptions = {},
  ) {}

  private get locale(): string {
    return this.options.language ?? "ja-JP";
  }

  private get executablePath(): string {
    return path.resolve(
      process.cwd(),
      "tools/apple-speech-transcriber/.build/release/apple-speech-transcriber",
    );
  }

  get parameters(): Readonly<Record<string, unknown>> {
    return {
      framework: "SpeechAnalyzer",
      model: this.engine === "dictation" ? "DictationTranscriber" : "SpeechTranscriber",
      locale: this.locale,
      preset: this.engine === "dictation" ? "longDictation" : "transcription",
      processing: "on-device",
      timing: "analyze+finalize (excludes helper launch, asset checks, and queue wait)",
    };
  }

  transcribe(audioFullPath: string, sampleId: string) {
    return Effect.gen(this, function* () {
      if (process.platform !== "darwin") {
        return yield* Effect.fail(
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: "Apple SpeechTranscriber requires macOS 26 or newer",
          }),
        );
      }

      if (!fs.existsSync(this.executablePath)) {
        return yield* Effect.fail(
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: "Apple SpeechTranscriber helper is not built. Run 'pnpm apple:prepare' first.",
          }),
        );
      }

      const result = yield* Effect.tryPromise({
        try: () =>
          gate.run(() =>
            execFileAsync(
              this.executablePath,
              ["--engine", this.engine, "--locale", this.locale, audioFullPath],
              {
                encoding: "utf8",
                maxBuffer: 8 * 1024 * 1024,
              },
            ),
          ),
        catch: (error) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Apple ${this.engine === "dictation" ? "DictationTranscriber" : "SpeechTranscriber"} failed: ${String(error)}`,
            cause: error,
          }),
      });

      const output = yield* Effect.try({
        try: () =>
          Schema.decodeUnknownSync(AppleHelperOutputSchema)(JSON.parse(result.stdout) as unknown),
        catch: (error) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Apple helper returned invalid JSON: ${String(error)}`,
            cause: error,
          }),
      });

      return {
        hypothesis: output.transcript.trim(),
        latencyMs: Math.max(0, Math.round(output.transcriptionMs)),
      };
    });
  }
}
