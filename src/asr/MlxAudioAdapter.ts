import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Effect, Schema } from "effect";
import type { AsrAdapter } from "./types.js";
import { AsrExecutionError } from "../errors.js";
import { convertToWav16kMono } from "../utils/audio.js";
import { describeHostHardware, SerialGate } from "../utils/on-device.js";
import type { AsrModelOptions } from "../schemas/config.js";

const execFileAsync = promisify(execFile);

/** One local model owns the GPU; overlapping runs would measure contention. */
const gate = new SerialGate();

const MlxHelperOutputSchema = Schema.Struct({
  transcript: Schema.String,
  transcriptionMs: Schema.Number,
  modelLoadMs: Schema.Number,
  promptTokens: Schema.Number,
  generationTokens: Schema.Number,
});

/**
 * Qwen3-ASR conditions on a language *name*, not an ISO code, and falls back to
 * auto-detection for anything it does not recognise. Every other adapter here
 * takes a code, so codes are translated and unknown values are passed through.
 */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ar: "Arabic",
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  nl: "Dutch",
  pt: "Portuguese",
  ru: "Russian",
  yue: "Cantonese",
  zh: "Chinese",
};

/**
 * Speech-to-text models run locally on Apple Silicon through
 * [mlx-audio](https://github.com/Blaizzy/mlx-audio) - Qwen3-ASR here, but the
 * helper takes any model id mlx-audio can load.
 *
 * The weights are loaded per request, because the adapter interface is one
 * process per sample; the helper times generation separately so that loading
 * does not enter the reported latency. Audio that is not WAV is transcoded with
 * ffmpeg first (also excluded from latency).
 */
export class MlxAudioAdapter implements AsrAdapter {
  readonly provider = "mlx-audio";

  constructor(
    public readonly modelId: string,
    public readonly displayName: string,
    private readonly modelName = "mlx-community/Qwen3-ASR-1.7B-8bit",
    private readonly options: AsrModelOptions = {},
  ) {}

  /** Interpreter of the venv created by `pnpm mlx:prepare`, unless overridden. */
  private get pythonPath(): string {
    return (
      process.env["MLX_AUDIO_PYTHON"] ??
      path.resolve(process.cwd(), "tools/mlx-audio/.venv/bin/python")
    );
  }

  private get helperPath(): string {
    return path.resolve(process.cwd(), "tools/mlx-audio/transcribe.py");
  }

  private get language(): string | undefined {
    const requested = this.options.language;
    if (!requested) return undefined;
    const primary = requested.split("-")[0]?.toLowerCase() ?? requested.toLowerCase();
    return LANGUAGE_NAMES[requested.toLowerCase()] ?? LANGUAGE_NAMES[primary] ?? requested;
  }

  private buildArgs(wavPath: string): string[] {
    const args = [this.helperPath, wavPath, "--model", this.modelName];
    const language = this.language;
    if (language) args.push("--language", language);
    if (this.options.prompt) args.push("--prompt", this.options.prompt);
    for (const keyword of this.options.keywords ?? []) args.push("--hotword", keyword);
    if (this.options.maxOutputTokens !== undefined) {
      args.push("--max-tokens", String(this.options.maxOutputTokens));
    }
    if (this.options.chunkSeconds !== undefined) {
      args.push("--chunk-duration", String(this.options.chunkSeconds));
    }
    if (this.options.batchSegments !== undefined) {
      args.push("--batch-size", String(this.options.batchSegments));
    }
    if (this.options.temperature !== undefined) {
      args.push("--temperature", String(this.options.temperature));
    }
    return args;
  }

  get parameters(): Readonly<Record<string, unknown>> {
    return {
      framework: "mlx-audio (Apple MLX)",
      model: this.modelName,
      language: this.language ?? "auto-detected",
      prompt: this.options.prompt ?? "none",
      hotwords: this.options.keywords ?? [],
      maxTokens: this.options.maxOutputTokens ?? "8192 (library default)",
      chunkSeconds: this.options.chunkSeconds ?? "1200 (library default)",
      batchSegments: this.options.batchSegments ?? "1 (library default)",
      temperature: this.options.temperature ?? "0.0 (library default)",
      processing: "on-device",
      hardware: describeHostHardware(),
      timing: "generation only (excludes model load, audio transcoding, and queue wait)",
    };
  }

  transcribe(audioFullPath: string, sampleId: string) {
    return Effect.gen(this, function* () {
      if (!fs.existsSync(this.pythonPath)) {
        return yield* Effect.fail(
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `mlx-audio environment not found at ${this.pythonPath}. Run 'pnpm mlx:prepare' first, or set MLX_AUDIO_PYTHON.`,
          }),
        );
      }

      if (!fs.existsSync(audioFullPath)) {
        return yield* Effect.fail(
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Audio file does not exist at ${audioFullPath}`,
          }),
        );
      }

      const isWav = path.extname(audioFullPath).toLowerCase() === ".wav";
      const wavPath = isWav
        ? audioFullPath
        : yield* Effect.tryPromise({
            try: () => convertToWav16kMono(audioFullPath),
            catch: (err) =>
              new AsrExecutionError({
                modelId: this.modelId,
                sampleId,
                message: `ffmpeg conversion to WAV failed (is ffmpeg installed?): ${String(err)}`,
                cause: err,
              }),
          });

      const result = yield* Effect.tryPromise({
        try: () =>
          gate.run(() =>
            execFileAsync(this.pythonPath, this.buildArgs(wavPath), {
              encoding: "utf8",
              maxBuffer: 16 * 1024 * 1024,
            }),
          ),
        catch: (err) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `mlx-audio transcription failed: ${String(err)}`,
            cause: err,
          }),
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (!isWav) {
              try {
                fs.unlinkSync(wavPath);
              } catch {
                // temp file already gone; nothing to clean up
              }
            }
          }),
        ),
      );

      const output = yield* Effect.try({
        try: () =>
          Schema.decodeUnknownSync(MlxHelperOutputSchema)(JSON.parse(result.stdout) as unknown),
        catch: (err) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `mlx-audio helper returned invalid JSON: ${String(err)}`,
            cause: err,
          }),
      });

      return {
        hypothesis: output.transcript.trim(),
        latencyMs: Math.max(0, Math.round(output.transcriptionMs)),
        usage: {
          inputTokens: output.promptTokens,
          outputTokens: output.generationTokens,
          totalTokens: output.promptTokens + output.generationTokens,
        },
      };
    });
  }
}
