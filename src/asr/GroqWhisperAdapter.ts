import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import type { AsrAdapter } from "./types.js";
import { AsrExecutionError } from "../errors.js";
import { fetchWithRetry } from "../utils/http.js";
import type { AsrModelOptions } from "../schemas/config.js";

/**
 * Groq-hosted Whisper (OpenAI-compatible transcription endpoint).
 */
export class GroqWhisperAdapter implements AsrAdapter {
  readonly provider = "groq";

  constructor(
    public readonly modelId: string,
    public readonly displayName: string,
    private readonly modelName = "whisper-large-v3",
    private readonly apiKey = process.env["GROQ_API_KEY"],
    private readonly endpoint = "https://api.groq.com/openai/v1/audio/transcriptions",
    private readonly options: AsrModelOptions = {},
  ) {}

  private get language(): string {
    return this.options.language ?? "ja";
  }

  private get responseFormat(): string {
    return this.options.responseFormat ?? "json";
  }

  get parameters(): Readonly<Record<string, unknown>> {
    return {
      model: this.modelName,
      endpoint: this.endpoint,
      language: this.language,
      response_format: this.responseFormat,
      temperature: this.options.temperature ?? "provider default",
      prompt: this.options.prompt ?? "(none)",
    };
  }

  transcribe(audioFullPath: string, sampleId: string) {
    return Effect.gen(this, function* () {
      if (!this.apiKey) {
        return yield* Effect.fail(
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: "GROQ_API_KEY is not set in environment or config",
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

      const fileBuffer = fs.readFileSync(audioFullPath);
      const filename = path.basename(audioFullPath);

      const formData = new FormData();
      formData.append("file", new Blob([fileBuffer]), filename);
      formData.append("model", this.modelName);
      formData.append("response_format", this.responseFormat);
      if (this.language) {
        formData.append("language", this.language);
      }
      if (this.options.temperature !== undefined) {
        formData.append("temperature", String(this.options.temperature));
      }
      if (this.options.prompt) {
        formData.append("prompt", this.options.prompt);
      }

      const startTime = Date.now();

      const response = yield* Effect.tryPromise({
        try: async () => {
          const res = await fetchWithRetry(this.endpoint, {
            method: "POST",
            headers: { Authorization: `Bearer ${this.apiKey}` },
            body: formData,
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Groq Whisper API returned ${res.status}: ${errText}`);
          }
          return await res.json();
        },
        catch: (err) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Groq Whisper request failed: ${String(err)}`,
            cause: err,
          }),
      });

      const latencyMs = Date.now() - startTime;
      const resObj = response as { text?: string };
      return { hypothesis: resObj.text?.trim() ?? "", latencyMs };
    });
  }
}
