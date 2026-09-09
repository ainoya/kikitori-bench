import { Effect } from "effect";
import type { AsrAdapter } from "./types.js";
import { AsrExecutionError } from "../errors.js";
import { getAudioMimeType, readAudioBase64 } from "../utils/audio.js";
import type { TokenUsage } from "../schemas/asr.js";
import { fetchWithRetry } from "../utils/http.js";
import type { AsrModelOptions } from "../schemas/config.js";

const DEFAULT_PROMPT =
  "Please transcribe the speech in this audio verbatim in Japanese. Do not add any preamble, explanation, or notes. Output only the transcribed text.";

export class GeminiAdapter implements AsrAdapter {
  readonly provider = "gemini";

  constructor(
    public readonly modelId: string,
    public readonly displayName: string,
    private readonly modelName = "gemini-3.8-flash",
    private readonly apiKey = process.env["GEMINI_API_KEY"],
    private readonly options: AsrModelOptions = {}
  ) {}

  get parameters(): Readonly<Record<string, unknown>> {
    return {
      model: this.modelName,
      endpoint: "generativelanguage.googleapis.com/v1beta:generateContent",
      prompt: this.options.prompt ?? DEFAULT_PROMPT,
      temperature: this.options.temperature ?? "provider default",
      thinkingBudget: this.options.thinkingBudget ?? "provider default",
      thinkingLevel: this.options.thinkingLevel ?? "provider default",
      maxOutputTokens: this.options.maxOutputTokens ?? "provider default"
    };
  }

  transcribe(audioFullPath: string, sampleId: string) {
    return Effect.gen(this, function* () {
      if (!this.apiKey) {
        return yield* Effect.fail(
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: "GEMINI_API_KEY is not set in environment or config"
          })
        );
      }

      const mimeType = getAudioMimeType(audioFullPath);
      const base64Data = readAudioBase64(audioFullPath);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;

      const generationConfig: Record<string, unknown> | undefined = buildGenerationConfig(this.options);

      const payload = {
        contents: [
          {
            role: "user",
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data
                }
              },
              {
                text: this.options.prompt ?? DEFAULT_PROMPT
              }
            ]
          }
        ],
        ...(generationConfig ? { generationConfig } : {})
      };

      const startTime = Date.now();

      const response = yield* Effect.tryPromise({
        try: async () => {
          const res = await fetchWithRetry(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Gemini ASR returned ${res.status}: ${errText}`);
          }
          return await res.json();
        },
        catch: (err) =>
          new AsrExecutionError({
            modelId: this.modelId,
            sampleId,
            message: `Gemini API request failed: ${String(err)}`,
            cause: err
          })
      });

      const latencyMs = Date.now() - startTime;
      const resObj = response as {
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          thoughtsTokenCount?: number;
          cachedContentTokenCount?: number;
          totalTokenCount?: number;
          promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
        };
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              audioTranscription?: {
                text?: string;
              };
            }>;
          };
        }>;
      };

      const parts = resObj.candidates?.[0]?.content?.parts ?? [];
      const hypothesis = parts
        .map((p) => p.audioTranscription?.text ?? p.text ?? "")
        .join("")
        .trim();
      const um = resObj.usageMetadata;
      const modalityTokens = (modality: string): number | undefined =>
        um?.promptTokensDetails?.find((d) => d.modality === modality)?.tokenCount;

      const usage: TokenUsage = {
        inputTokens: um?.promptTokenCount,
        audioInputTokens: modalityTokens("AUDIO"),
        textInputTokens: modalityTokens("TEXT"),
        cachedInputTokens: um?.cachedContentTokenCount,
        outputTokens: (um?.candidatesTokenCount ?? 0) + (um?.thoughtsTokenCount ?? 0) || undefined,
        reasoningOutputTokens: um?.thoughtsTokenCount,
        totalTokens: um?.totalTokenCount
      };

      return { hypothesis, latencyMs, usage };
    });
  }
}

const buildGenerationConfig = (
  options: AsrModelOptions
): Record<string, unknown> | undefined => {
  const config: Record<string, unknown> = {};
  if (options.temperature !== undefined) config["temperature"] = options.temperature;
  if (options.maxOutputTokens !== undefined) config["maxOutputTokens"] = options.maxOutputTokens;
  // Gemini 3.x accepts thinkingBudget and thinkingLevel, both nested under
  // generationConfig.thinkingConfig (a top-level thinkingLevel is rejected).
  const thinking: Record<string, unknown> = {};
  if (options.thinkingBudget !== undefined) thinking["thinkingBudget"] = options.thinkingBudget;
  if (options.thinkingLevel !== undefined) thinking["thinkingLevel"] = options.thinkingLevel;
  if (Object.keys(thinking).length > 0) config["thinkingConfig"] = thinking;
  return Object.keys(config).length > 0 ? config : undefined;
};
