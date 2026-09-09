import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import type { AsrAdapter } from "./types.js";
import { AsrExecutionError } from "../errors.js";
import type { AsrModelOptions } from "../schemas/config.js";

export class WhisperAdapter implements AsrAdapter {
  readonly provider = "whisper";

  constructor(
    public readonly modelId: string,
    public readonly displayName: string,
    private readonly modelName = "whisper-1",
    private readonly apiKey = process.env["OPENAI_API_KEY"],
    private readonly options: AsrModelOptions = {}
  ) {}

  private get language(): string {
    return this.options.language ?? "ja";
  }

  get parameters(): Readonly<Record<string, unknown>> {
    return {
      model: this.modelName,
      endpoint: "https://api.openai.com/v1/audio/transcriptions",
      language: this.language,
      response_format: this.options.responseFormat ?? "json",
      temperature: this.options.temperature ?? "provider default",
      prompt: this.options.prompt ?? "(none)"
    };
  }

  transcribe(audioFullPath: string, sampleId: string) {
    return Effect.gen(this, function* () {
      if (!this.apiKey) {
        return yield* Effect.fail(
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: "OPENAI_API_KEY is not set in environment or config"
          })
        );
      }

      const fileBuffer = fs.readFileSync(audioFullPath);
      const filename = path.basename(audioFullPath);
      const blob = new Blob([fileBuffer]);

      const formData = new FormData();
      formData.append("file", blob, filename);
      formData.append("model", this.modelName);
      formData.append("language", this.language);
      if (this.options.responseFormat) {
        formData.append("response_format", this.options.responseFormat);
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
          const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`
            },
            body: formData
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`OpenAI Whisper returned ${res.status}: ${errText}`);
          }
          return await res.json();
        },
        catch: (err) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Whisper API request failed: ${String(err)}`,
            cause: err
          })
      });

      const latencyMs = Date.now() - startTime;
      const resObj = response as { text?: string };
      const hypothesis = resObj.text?.trim() ?? "";

      return { hypothesis, latencyMs };
    });
  }
}
