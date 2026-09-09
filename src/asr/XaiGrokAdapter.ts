import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import type { AsrAdapter } from "./types.js";
import { AsrExecutionError } from "../errors.js";
import { fetchWithRetry } from "../utils/http.js";
import type { AsrModelOptions } from "../schemas/config.js";

export class XaiGrokAdapter implements AsrAdapter {
  readonly provider = "xai";

  constructor(
    public readonly modelId: string,
    public readonly displayName: string,
    private readonly modelName = "grok-stt",
    private readonly apiKey = process.env["XAI_API_KEY"],
    private readonly endpoint = "https://api.x.ai/v1/stt",
    private readonly options: AsrModelOptions = {}
  ) {}

  private get language(): string {
    return this.options.language ?? "ja";
  }

  get parameters(): Readonly<Record<string, unknown>> {
    return {
      model: this.modelName,
      endpoint: this.endpoint,
      language: this.language,
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
            message: "XAI_API_KEY is not set in environment or config"
          })
        );
      }

      if (!fs.existsSync(audioFullPath)) {
        return yield* Effect.fail(
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Audio file does not exist at ${audioFullPath}`
          })
        );
      }

      const fileBuffer = fs.readFileSync(audioFullPath);
      const filename = path.basename(audioFullPath);
      const blob = new Blob([fileBuffer]);

      const formData = new FormData();
      formData.append("file", blob, filename);
      formData.append("model", this.modelName);
      if (this.language) {
        formData.append("language", this.language);
      }
      if (this.options.prompt) {
        formData.append("prompt", this.options.prompt);
      }

      const startTime = Date.now();

      const response = yield* Effect.tryPromise({
        try: async () => {
          const res = await fetchWithRetry(this.endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`
            },
            body: formData
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`xAI STT API returned ${res.status}: ${errText}`);
          }

          return await res.json();
        },
        catch: (err) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `xAI Grok STT request failed: ${String(err)}`,
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
