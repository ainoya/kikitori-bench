import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import type { AsrAdapter } from "./types.js";
import { AsrExecutionError } from "../errors.js";
import { fetchWithRetry } from "../utils/http.js";
import { convertToWav16kMono } from "../utils/audio.js";
import type { AsrModelOptions } from "../schemas/config.js";

/**
 * Meta Muse Voice Transcribe (file transcription endpoint).
 * The API only accepts mono 16-bit PCM WAV, so non-WAV inputs are
 * transcoded with ffmpeg before upload (transcoding is excluded from latency).
 */
export class MetaMuseAdapter implements AsrAdapter {
  readonly provider = "meta";

  constructor(
    public readonly modelId: string,
    public readonly displayName: string,
    private readonly modelName = "muse-voice-transcribe-1.0",
    private readonly apiKey = process.env["META_API_KEY"],
    private readonly endpoint = "https://api.meta.ai/v1/asr/transcribe",
    private readonly options: AsrModelOptions = {},
  ) {}

  private get languageBias(): readonly string[] {
    return this.options.languageBias ?? ["Japanese"];
  }

  private get mode(): string {
    return this.options.mode ?? "DIARIZATION";
  }

  private get audioEncoding(): string {
    return this.options.audioEncoding ?? "WAV";
  }

  get parameters(): Readonly<Record<string, unknown>> {
    return {
      model: this.modelName,
      endpoint: this.endpoint,
      mode: this.mode,
      audioEncoding: this.audioEncoding,
      languageBias: this.languageBias,
      keywords: this.options.keywords ?? [],
      preprocessing: "ffmpeg -ac 1 -ar 16000 -c:a pcm_s16le",
    };
  }

  transcribe(audioFullPath: string, sampleId: string) {
    return Effect.gen(this, function* () {
      if (!this.apiKey) {
        return yield* Effect.fail(
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: "META_API_KEY is not set in environment or config",
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
        try: async () => {
          const fileBuffer = fs.readFileSync(wavPath);
          const requestConfig = JSON.stringify({
            mode: this.mode,
            model: this.modelName,
            audioEncoding: this.audioEncoding,
            ...(this.languageBias.length > 0 ? { languageBias: this.languageBias } : {}),
            ...(this.options.keywords && this.options.keywords.length > 0
              ? { keywords: this.options.keywords }
              : {}),
          });

          const formData = new FormData();
          formData.append("request", new Blob([requestConfig], { type: "application/json" }));
          formData.append("audio", new Blob([fileBuffer]), path.basename(wavPath));

          const url = `${this.endpoint}?sessionId=kikitori-${encodeURIComponent(sampleId)}`;
          const startTime = Date.now();
          const res = await fetchWithRetry(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${this.apiKey}` },
            body: formData,
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Meta Muse ASR returned ${res.status}: ${errText}`);
          }
          const json = (await res.json()) as {
            transcript?: string;
            turns?: ReadonlyArray<{ transcript?: string }>;
          };
          const latencyMs = Date.now() - startTime;
          const hypothesis =
            json.transcript?.trim() ??
            (json.turns ?? [])
              .map((t) => t.transcript ?? "")
              .join(" ")
              .trim();
          return { hypothesis, latencyMs };
        },
        catch: (err) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Meta Muse Voice Transcribe request failed: ${String(err)}`,
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

      return result;
    });
  }
}
