import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import type { AsrAdapter } from "./types.js";
import { AsrExecutionError } from "../errors.js";
import { getAudioMimeType, readAudioBase64 } from "../utils/audio.js";
import type { TokenUsage } from "../schemas/asr.js";
import { fetchWithRetry } from "../utils/http.js";
import type { AsrModelOptions } from "../schemas/config.js";

const DEFAULT_PROMPT =
  "Please transcribe the speech in this audio verbatim in Japanese. Do not add any preamble, explanation, or notes. Output only the transcribed text.";

/** The endpoint rejects a Base64 audio string above this size. */
const MAX_BASE64_BYTES = 10 * 1024 * 1024;

/**
 * Qwen omni models on Alibaba Model Studio, through its OpenAI-compatible
 * chat completions endpoint. Audio goes in as a Base64 data URI; the model
 * answers with text only, so `modalities` is always `["text"]`.
 *
 * The endpoint is region-scoped and so is the key: request data stays in the
 * region the endpoint belongs to, which makes the default worth stating rather
 * than inheriting.
 */
export class QwenOmniAdapter implements AsrAdapter {
  readonly provider = "qwen";

  constructor(
    public readonly modelId: string,
    public readonly displayName: string,
    private readonly modelName = "qwen3.8-omni-flash",
    private readonly apiKey = process.env["QWEN_API_KEY"],
    private readonly endpoint = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
    private readonly options: AsrModelOptions = {},
  ) {}

  get parameters(): Readonly<Record<string, unknown>> {
    return {
      model: this.modelName,
      endpoint: this.endpoint,
      prompt: this.options.prompt ?? DEFAULT_PROMPT,
      modalities: ["text"],
      reasoningEffort: this.options.reasoningEffort ?? "provider default",
      temperature: this.options.temperature ?? "provider default",
      maxOutputTokens: this.options.maxOutputTokens ?? "provider default",
    };
  }

  transcribe(audioFullPath: string, sampleId: string) {
    return Effect.gen(this, function* () {
      if (!this.apiKey) {
        return yield* Effect.fail(
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: "QWEN_API_KEY is not set in environment or config",
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

      const base64Data = readAudioBase64(audioFullPath);
      if (base64Data.length > MAX_BASE64_BYTES) {
        // Caught here rather than at the provider, where it surfaces as an
        // opaque error that reads like a transient failure and gets retried.
        return yield* Effect.fail(
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Base64 audio is ${(base64Data.length / 1048576).toFixed(1)} MB, above the ${MAX_BASE64_BYTES / 1048576} MB limit`,
          }),
        );
      }

      const mimeType = getAudioMimeType(audioFullPath);
      const format = path.extname(audioFullPath).toLowerCase().replace(".", "");

      const payload = {
        model: this.modelName,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: `data:${mimeType};base64,${base64Data}`,
                  format,
                },
              },
              {
                type: "text",
                text: this.options.prompt ?? DEFAULT_PROMPT,
              },
            ],
          },
        ],
        // qwen3.8-omni-flash returns text only; asking for audio is rejected.
        modalities: ["text"],
        ...(this.options.reasoningEffort !== undefined
          ? { reasoning_effort: this.options.reasoningEffort }
          : {}),
        ...(this.options.temperature !== undefined
          ? { temperature: this.options.temperature }
          : {}),
        ...(this.options.maxOutputTokens !== undefined
          ? { max_tokens: this.options.maxOutputTokens }
          : {}),
      };

      const startTime = Date.now();

      const response = yield* Effect.tryPromise({
        try: async () => {
          const res = await fetchWithRetry(this.endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Qwen omni API returned ${res.status}: ${errText}`);
          }
          return await res.json();
        },
        catch: (err) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Qwen omni request failed: ${String(err)}`,
            cause: err,
          }),
      });

      const latencyMs = Date.now() - startTime;
      const resObj = response as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_tokens_details?: {
            audio_tokens?: number;
            text_tokens?: number;
            cached_tokens?: number;
          };
          completion_tokens_details?: { reasoning_tokens?: number; text_tokens?: number };
        };
      };

      const hypothesis = resObj.choices?.[0]?.message?.content?.trim() ?? "";
      const u = resObj.usage;

      const usage: TokenUsage = {
        inputTokens: u?.prompt_tokens,
        audioInputTokens: u?.prompt_tokens_details?.audio_tokens,
        textInputTokens: u?.prompt_tokens_details?.text_tokens,
        cachedInputTokens: u?.prompt_tokens_details?.cached_tokens,
        // `completion_tokens` already includes the reasoning tokens, which are
        // billed at the output rate like any other.
        outputTokens: u?.completion_tokens,
        reasoningOutputTokens: u?.completion_tokens_details?.reasoning_tokens,
        totalTokens: u?.total_tokens,
      };

      return { hypothesis, latencyMs, usage };
    });
  }
}
