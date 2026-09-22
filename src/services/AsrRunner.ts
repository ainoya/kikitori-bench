import * as fs from "node:fs";
import * as path from "node:path";
import { Context, Effect, Layer } from "effect";
import type { AsrAdapter } from "../asr/types.js";
import { GeminiAdapter } from "../asr/GeminiAdapter.js";
import { WhisperAdapter } from "../asr/WhisperAdapter.js";
import { XaiGrokAdapter } from "../asr/XaiGrokAdapter.js";
import { GroqWhisperAdapter } from "../asr/GroqWhisperAdapter.js";
import { MetaMuseAdapter } from "../asr/MetaMuseAdapter.js";
import { QwenOmniAdapter } from "../asr/QwenOmniAdapter.js";
import { AppleSpeechAdapter } from "../asr/AppleSpeechAdapter.js";
import { MlxAudioAdapter } from "../asr/MlxAudioAdapter.js";
import { CustomHttpAdapter } from "../asr/CustomHttpAdapter.js";
import { CustomCommandAdapter } from "../asr/CustomCommandAdapter.js";
import { MockAdapter } from "../asr/MockAdapter.js";
import type { AppConfig } from "../schemas/config.js";
import type { DatasetItem } from "../schemas/dataset.js";
import type { AsrResult, AsrBatchRun } from "../schemas/asr.js";
import { AsrExecutionError, ValidationError } from "../errors.js";
import { getAudioDurationMs } from "../utils/audio.js";

export interface AsrRunnerShape {
  createAdapter(modelId: string, config: AppConfig): Effect.Effect<AsrAdapter, ValidationError>;
  runBatch(
    datasetName: string,
    items: readonly DatasetItem[],
    models: readonly string[],
    config: AppConfig,
    concurrency?: number,
    /**
     * Existing run to extend instead of opening a new one. The checkpoint in
     * that directory already answers every (model, sample) pair it holds, so
     * only the new model is actually transcribed, and the run keeps the
     * conditions the other models were measured under.
     */
    intoRunId?: string,
  ): Effect.Effect<AsrBatchRun, AsrExecutionError | ValidationError>;
}

export class AsrRunner extends Context.Tag("AsrRunner")<AsrRunner, AsrRunnerShape>() {}

const outPathFor = (runDir: string): string => path.resolve(runDir, "asr_results.json");

/** The manifest of a run being extended; absent or unreadable means start fresh. */
const readBatchRun = (outPath: string): AsrBatchRun | undefined => {
  if (!fs.existsSync(outPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(outPath, "utf-8")) as AsrBatchRun;
  } catch {
    return undefined;
  }
};

export const AsrRunnerLive = Layer.succeed(
  AsrRunner,
  AsrRunner.of({
    createAdapter(modelId: string, config: AppConfig) {
      return Effect.gen(this, function* () {
        const modelConf = config.models[modelId];
        if (!modelConf) {
          // Check if it's a known built-in default
          if (modelId === "gemini-flash" || modelId === "gemini-3.8-flash") {
            return new GeminiAdapter(modelId, "Gemini 3.8 Flash", "gemini-3.8-flash");
          }
          if (modelId === "whisper-1" || modelId === "whisper") {
            return new WhisperAdapter(modelId, "OpenAI Whisper", "whisper-1");
          }
          if (modelId === "xai-grok" || modelId === "grok") {
            return new XaiGrokAdapter(
              modelId,
              "Grok Voice Transcribe 2.0",
              "grok-voice-transcribe-2.0",
            );
          }
          if (modelId === "gemini-transcribe" || modelId === "gemini-3.5-transcribe") {
            return new GeminiAdapter(modelId, "Gemini 3.5 Transcribe", "gemini-3.5-transcribe");
          }
          if (modelId === "groq-whisper" || modelId === "whisper-large-v3") {
            return new GroqWhisperAdapter(modelId, "Groq Whisper large-v3", "whisper-large-v3");
          }
          if (modelId === "meta-muse" || modelId === "muse-voice-transcribe") {
            return new MetaMuseAdapter(
              modelId,
              "Meta Muse Voice Transcribe",
              "muse-voice-transcribe-1.0",
            );
          }
          if (modelId === "apple-speech" || modelId === "speech-transcriber") {
            return new AppleSpeechAdapter(modelId, "Apple SpeechTranscriber");
          }
          if (modelId === "qwen3-asr-mlx" || modelId === "qwen3-asr-1.7b") {
            return new MlxAudioAdapter(
              modelId,
              "Qwen3-ASR 1.7B (MLX)",
              "mlx-community/Qwen3-ASR-1.7B-8bit",
            );
          }
          if (modelId === "mock") {
            return new MockAdapter("mock", "Mock ASR Model");
          }
          return yield* Effect.fail(
            new ValidationError({
              message: `Model '${modelId}' is not configured in kikitori.config.yaml`,
            }),
          );
        }

        const displayName = modelConf.displayName ?? modelId;

        switch (modelConf.type) {
          case "xai":
            return new XaiGrokAdapter(
              modelId,
              displayName,
              modelConf.model ?? "grok-stt",
              modelConf.apiKey,
              modelConf.endpoint ?? "https://api.x.ai/v1/stt",
              modelConf.options,
            );
          case "gemini":
            return new GeminiAdapter(
              modelId,
              displayName,
              modelConf.model ?? "gemini-3.8-flash",
              modelConf.apiKey,
              modelConf.options,
            );
          case "whisper":
            return new WhisperAdapter(
              modelId,
              displayName,
              modelConf.model ?? "whisper-1",
              modelConf.apiKey,
              modelConf.options,
            );
          case "groq":
            return new GroqWhisperAdapter(
              modelId,
              displayName,
              modelConf.model ?? "whisper-large-v3",
              modelConf.apiKey,
              modelConf.endpoint ?? "https://api.groq.com/openai/v1/audio/transcriptions",
              modelConf.options,
            );
          case "meta":
            return new MetaMuseAdapter(
              modelId,
              displayName,
              modelConf.model ?? "muse-voice-transcribe-1.0",
              modelConf.apiKey,
              modelConf.endpoint ?? "https://api.meta.ai/v1/asr/transcribe",
              modelConf.options,
            );
          case "qwen":
            return new QwenOmniAdapter(
              modelId,
              displayName,
              modelConf.model ?? "qwen3.8-omni-flash",
              modelConf.apiKey,
              modelConf.endpoint ??
                "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
              modelConf.options,
            );
          case "apple":
            if (
              modelConf.model !== undefined &&
              modelConf.model !== "speech-transcriber" &&
              modelConf.model !== "dictation"
            ) {
              return yield* Effect.fail(
                new ValidationError({
                  message: `Apple model '${modelId}' must use 'speech-transcriber' or 'dictation'`,
                }),
              );
            }
            return new AppleSpeechAdapter(
              modelId,
              displayName,
              modelConf.model ?? "speech-transcriber",
              modelConf.options,
            );
          case "mlx-audio":
            return new MlxAudioAdapter(
              modelId,
              displayName,
              modelConf.model ?? "mlx-community/Qwen3-ASR-1.7B-8bit",
              modelConf.options,
            );
          case "custom-http":
            if (!modelConf.endpoint) {
              return yield* Effect.fail(
                new ValidationError({
                  message: `Custom HTTP model '${modelId}' requires an 'endpoint' configuration`,
                }),
              );
            }
            return new CustomHttpAdapter(
              modelId,
              displayName,
              modelConf.endpoint,
              modelConf.apiKey,
            );
          case "custom-command":
            if (!modelConf.command) {
              return yield* Effect.fail(
                new ValidationError({
                  message: `Custom command model '${modelId}' requires a 'command' configuration`,
                }),
              );
            }
            return new CustomCommandAdapter(modelId, displayName, modelConf.command);
          case "mock":
            return new MockAdapter(modelId, displayName);
        }
      });
    },

    runBatch(
      datasetName: string,
      items: readonly DatasetItem[],
      modelIds: readonly string[],
      config: AppConfig,
      concurrency = 3,
      intoRunId?: string,
    ) {
      return Effect.gen(this, function* () {
        const adapters: AsrAdapter[] = [];
        for (const mId of modelIds) {
          const adapter = yield* this.createAdapter(mId, config);
          adapters.push(adapter);
        }

        const datasetDir = path.resolve(process.cwd(), "datasets", datasetName);
        const runId = intoRunId ?? `run_${new Date().toISOString().replace(/[:.]/g, "-")}`;
        const runDir = path.resolve(process.cwd(), "runs", runId);

        if (intoRunId && !fs.existsSync(runDir)) {
          return yield* Effect.fail(
            new ValidationError({ message: `Run '${intoRunId}' does not exist at ${runDir}` }),
          );
        }
        const existing = intoRunId ? readBatchRun(outPathFor(runDir)) : undefined;
        if (existing && existing.datasetName !== datasetName) {
          // Merging across datasets would produce a run whose models were never
          // asked the same questions.
          return yield* Effect.fail(
            new ValidationError({
              message: `Run '${intoRunId}' was measured on dataset '${existing.datasetName}', not '${datasetName}'`,
            }),
          );
        }
        if (!fs.existsSync(runDir)) {
          fs.mkdirSync(runDir, { recursive: true });
        }

        // Build list of tasks: (adapter, item)
        interface Task {
          adapter: AsrAdapter;
          item: DatasetItem;
        }
        const tasks: Task[] = [];
        for (const item of items) {
          for (const adapter of adapters) {
            tasks.push({ adapter, item });
          }
        }

        const resultsPath = path.resolve(runDir, "asr_results.jsonl");
        // Results are appended as they land: a provider rejecting one file (Meta
        // Muse caps audio at 10 minutes) must not cost the other 700 requests.
        const done = new Map<string, AsrResult>();
        if (fs.existsSync(resultsPath)) {
          for (const line of fs.readFileSync(resultsPath, "utf-8").split("\n")) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line) as AsrResult;
              done.set(`${parsed.modelId}::${parsed.sampleId}`, parsed);
            } catch {
              // A half-written final line after a crash; ignore it.
            }
          }
        }

        const runTask = (task: Task): Effect.Effect<AsrResult> =>
          Effect.gen(this, function* () {
            const cached = done.get(`${task.adapter.modelId}::${task.item.id}`);
            if (cached) return cached;

            const audioFullPath = path.resolve(datasetDir, task.item.audioPath);
            const audioDurationMs = yield* Effect.promise(() => getAudioDurationMs(audioFullPath));

            const result = yield* task.adapter.transcribe(audioFullPath, task.item.id).pipe(
              Effect.map((res) => ({
                sampleId: task.item.id,
                modelId: task.adapter.modelId,
                hypothesis: res.hypothesis,
                latencyMs: res.latencyMs,
                audioDurationMs: audioDurationMs > 0 ? audioDurationMs : undefined,
                rtf:
                  audioDurationMs > 0
                    ? Math.round((res.latencyMs / audioDurationMs) * 1000) / 1000
                    : undefined,
                timestamp: new Date().toISOString(),
                usage: res.usage,
              })),
              // One model failing on one file is data about that model, not a
              // reason to abandon the batch.
              Effect.catchAll((err) =>
                Effect.sync(() => {
                  console.error(`   ✗ ${task.adapter.modelId} / ${task.item.id}: ${err.message}`);
                  return {
                    sampleId: task.item.id,
                    modelId: task.adapter.modelId,
                    hypothesis: "",
                    latencyMs: 0,
                    audioDurationMs: audioDurationMs > 0 ? audioDurationMs : undefined,
                    timestamp: new Date().toISOString(),
                    error: err.message,
                  } satisfies AsrResult;
                }),
              ),
            );

            fs.appendFileSync(resultsPath, `${JSON.stringify(result)}\n`, "utf-8");
            return result;
          });

        const results = yield* Effect.all(tasks.map(runTask), { concurrency });

        const conditions = adapters.map((adapter) => ({
          modelId: adapter.modelId,
          displayName: adapter.displayName,
          provider: adapter.provider,
          parameters: adapter.parameters,
        }));

        const previous = existing;

        const batchRun: AsrBatchRun = previous
          ? {
              ...previous,
              // The models measured earlier stay in the run exactly as they
              // were recorded; this pass only contributes what it just ran.
              models: [...new Set([...previous.models, ...modelIds])],
              conditions: [
                ...(previous.conditions ?? []).filter((c) => !modelIds.includes(c.modelId)),
                ...conditions,
              ],
              results: [
                ...previous.results.filter((r) => !modelIds.includes(r.modelId)),
                ...results,
              ],
            }
          : {
              runId,
              datasetName,
              timestamp: new Date().toISOString(),
              models: modelIds.slice(),
              conditions,
              results,
            };

        fs.writeFileSync(outPathFor(runDir), JSON.stringify(batchRun, null, 2), "utf-8");

        return batchRun;
      });
    },
  }),
);
