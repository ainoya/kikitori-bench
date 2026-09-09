import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import type { AsrAdapter } from "./types.js";
import { AsrExecutionError } from "../errors.js";

export class CustomHttpAdapter implements AsrAdapter {
  readonly provider = "custom-http";

  constructor(
    public readonly modelId: string,
    public readonly displayName: string,
    private readonly endpointUrl: string,
    private readonly apiKey?: string
  ) {}

  get parameters(): Readonly<Record<string, unknown>> {
    return { endpoint: this.endpointUrl };
  }

  transcribe(audioFullPath: string, sampleId: string) {
    return Effect.gen(this, function* () {
      const fileBuffer = fs.readFileSync(audioFullPath);
      const filename = path.basename(audioFullPath);
      const blob = new Blob([fileBuffer]);

      const formData = new FormData();
      formData.append("audio", blob, filename);
      formData.append("sampleId", sampleId);

      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const startTime = Date.now();

      const response = yield* Effect.tryPromise({
        try: async () => {
          const res = await fetch(this.endpointUrl, {
            method: "POST",
            headers,
            body: formData
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`Custom HTTP ASR returned status ${res.status}: ${text}`);
          }
          const contentType = res.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            return await res.json();
          }
          return { text: await res.text() };
        },
        catch: (err) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Failed to call custom HTTP endpoint ${this.endpointUrl}: ${String(err)}`,
            cause: err
          })
      });

      const latencyMs = Date.now() - startTime;
      const resObj = response as { text?: string; transcript?: string; hypothesis?: string };
      const hypothesis = (resObj.transcript ?? resObj.text ?? resObj.hypothesis ?? "").trim();

      return { hypothesis, latencyMs };
    });
  }
}
