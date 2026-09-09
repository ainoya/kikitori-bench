import * as fs from "node:fs";
import * as path from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { buildJudgePrompt } from "../judge/prompts.js";
import {
  WebSocketCodexClient,
  MockCodexClient,
  type CodexClient
} from "../judge/codex-client.js";
import type { AppConfig, EvaluationAxis } from "../schemas/config.js";
import type { DatasetItem } from "../schemas/dataset.js";
import type { AsrResult, ModelRunCondition } from "../schemas/asr.js";
import {
  BinaryCheckResultSchema,
  type BinaryCheckResult,
  type SampleEvaluation,
  type BenchmarkReport,
  type LeaderboardEntry
} from "../schemas/judge.js";
import { JudgeConnectionError, JudgeEvaluationError } from "../errors.js";
import { getAudioDurationMs } from "../utils/audio.js";
import { buildRunUsageSummary, computeAsrCost, computeJudgeCost } from "../utils/cost.js";
import { buildRunAnalytics } from "./Analytics.js";
import { judgeOnce } from "../judge/turn.js";
import { isFatalJudgeError } from "../judge/codex-client.js";
import { getTokenizer, scoreProperNouns } from "../judge/lexical.js";
import {
  DEFAULT_F_BETA,
  EVALUATION_AXES,
  scoreVerdict
} from "../judge/scoring.js";

const ChecksContainerSchema = Schema.Struct({
  checks: Schema.Array(BinaryCheckResultSchema)
});
void ChecksContainerSchema;

/** Bump when the scoring semantics change so stale checkpoints are ignored. */
const SCORING_VERSION = "proper-noun-f1+proposition-f1-v2";

const checkpointPath = (runId: string): string =>
  path.resolve(process.cwd(), "runs", runId, "evaluations.jsonl");

/** Judged samples already on disk, so a crashed or resumed run re-judges nothing. */
const loadCheckpoint = (runId: string): Map<string, SampleEvaluation> => {
  const file = checkpointPath(runId);
  const cache = new Map<string, SampleEvaluation>();
  if (!fs.existsSync(file)) return cache;
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { version?: string; evaluation?: SampleEvaluation };
      if (entry.version !== SCORING_VERSION || !entry.evaluation) continue;
      cache.set(`${entry.evaluation.modelId}::${entry.evaluation.sampleId}`, entry.evaluation);
    } catch {
      // A partially written final line is expected after a crash; skip it.
    }
  }
  return cache;
};

const appendCheckpoint = (
  runId: string,
  evaluation: SampleEvaluation,
  verdict?: unknown
): void => {
  const file = checkpointPath(runId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // The verdict is the expensive part; keeping it lets `rescore` apply new
  // weights or a new formula without paying for the judge again.
  fs.appendFileSync(
    file,
    `${JSON.stringify({ version: SCORING_VERSION, evaluation, verdict })}\n`,
    "utf-8"
  );
};

export interface JudgeServiceShape {
  evaluateRun(
    runId: string,
    datasetName: string,
    items: readonly DatasetItem[],
    asrResults: readonly AsrResult[],
    config: AppConfig,
    useMockJudge?: boolean,
    asrConditions?: readonly ModelRunCondition[]
  ): Effect.Effect<BenchmarkReport, JudgeConnectionError | JudgeEvaluationError>;
}

export class JudgeService extends Context.Tag("JudgeService")<JudgeService, JudgeServiceShape>() {}


export const JudgeServiceLive = Layer.succeed(
  JudgeService,
  JudgeService.of({
    evaluateRun(
      runId: string,
      datasetName: string,
      items: readonly DatasetItem[],
      asrResults: readonly AsrResult[],
      config: AppConfig,
      useMockJudge = false,
      asrConditions: readonly ModelRunCondition[] = []
    ) {
      return Effect.gen(this, function* () {
        const itemMap = new Map(items.map((it) => [it.id, it]));
        const client: CodexClient =
          useMockJudge || config.judge.provider === "mock"
            ? new MockCodexClient()
            : new WebSocketCodexClient(config.judge.endpoint, config.judge.timeoutMs ?? 600_000);

        const judgeModel = config.judge.model;
        const judgeConcurrency = Math.max(1, config.judge.concurrency ?? 1);
        let completed = 0;
        const skipped: string[] = [];

        // Group ASR results by modelId
        const models = Array.from(new Set(asrResults.map((r) => r.modelId)));

        // Judge turns are independent: every generate() opens its own ephemeral
        // thread, so they can run concurrently without influencing each other.
        // Loaded once: the morphological dictionary is the slow part.
        const tokenizer = yield* Effect.promise(() => getTokenizer());

        const checkpoint = loadCheckpoint(runId);
        if (checkpoint.size > 0) {
          console.log(`   ♻️  Reusing ${checkpoint.size} judged samples from a previous attempt.`);
          completed = checkpoint.size;
        }

        const judgeTask = (res: AsrResult) =>
          Effect.gen(function* () {
            const item = itemMap.get(res.sampleId);
            if (!item) return null;

            const cached = checkpoint.get(`${res.modelId}::${res.sampleId}`);
            if (cached) return cached;

            let audioDurationMs = res.audioDurationMs;
            if (!audioDurationMs) {
              const audioFullPath = path.resolve(process.cwd(), "datasets", datasetName, item.audioPath);
              audioDurationMs = yield* Effect.promise(() => getAudioDurationMs(audioFullPath));
            }
            const rtf =
              res.rtf ??
              (audioDurationMs && audioDurationMs > 0
                ? Math.round((res.latencyMs / audioDurationMs) * 1000) / 1000
                : undefined);

            // If ASR returned an error or empty hypothesis
            if (res.error || !res.hypothesis) {
              const axes: EvaluationAxis[] = [...EVALUATION_AXES];
              const failChecks: BinaryCheckResult[] = axes.map((axis) => ({
                id: axis,
                axis,
                name: axis,
                pass: false,
                reason: res.error ? `ASR execution failed: ${res.error}` : "Hypothesis is empty"
              }));

              const failedAsrCost = computeAsrCost(
                res.usage,
                audioDurationMs,
                config.models[res.modelId]?.pricing
              );

              const failedEvaluation: SampleEvaluation = {
                sampleId: item.id,
                modelId: res.modelId,
                hypothesis: res.hypothesis ?? "",
                groundTruth: item.groundTruth,
                latencyMs: res.latencyMs,
                audioDurationMs: audioDurationMs > 0 ? audioDurationMs : undefined,
                rtf,
                checks: failChecks,
                categoryScores: {
                  proper_noun_f1: { passed: 0, total: 1, scorePercent: 0 },
                  proposition_recall: { passed: 0, total: 1, scorePercent: 0 },
                  proposition_precision: { passed: 0, total: 1, scorePercent: 0 },
                  proposition_f1: { passed: 0, total: 1, scorePercent: 0 }
                },
                overallScore: 0,
                asrUsage: res.usage,
                asrCostUsd: failedAsrCost?.costUsd,
                asrCostEstimated: failedAsrCost?.estimated
              };
              appendCheckpoint(runId, failedEvaluation);
              return failedEvaluation;
            }

            console.log(`   Judging ${res.modelId} on ${item.id}...`);

            const prompt = buildJudgePrompt({
              item,
              hypothesis: res.hypothesis,
              modelId: res.modelId
            });

            // One stalled turn or one malformed JSON reply must not abort a run
            // of hundreds, so the whole generate-and-parse cycle is retried.
            const judged = yield* judgeOnce({
              client,
              judgeModel,
              temperature: config.judge.temperature,
              prompt,
              item,
              modelId: res.modelId
            }).pipe(
              // A usage limit or auth failure will not fix itself; retrying it
              // across hundreds of samples only delays the inevitable.
              Effect.retry({
                times: config.judge.retries ?? 2,
                while: (err) => !isFatalJudgeError(err)
              }),
              Effect.tapError((err) =>
                Effect.sync(() =>
                  console.error(`   ✗ judge failed for ${res.modelId} on ${item.id}: ${err.message}`)
                )
              ),
              Effect.option
            );

            if (judged._tag === "None") {
              skipped.push(`${res.modelId}/${item.id}`);
              return null;
            }

            const { judgeResponse, verdict } = judged.value;
            const judgeCost = computeJudgeCost(judgeResponse.usage, config.judge.pricing);
            const asrCost = computeAsrCost(
              res.usage,
              audioDurationMs,
              config.models[res.modelId]?.pricing
            );

            const scored = scoreVerdict({
              verdict,
              item,
              audioDurationMs,
              weights: config.weights,
              fBeta: config.scoring?.fBeta ?? DEFAULT_F_BETA,
              lexical: scoreProperNouns(tokenizer, item.groundTruth, res.hypothesis)
            });
            const { checks, categoryScores, overallScore } = scored;

            const evaluation: SampleEvaluation = {
              sampleId: item.id,
              modelId: res.modelId,
              hypothesis: res.hypothesis,
              groundTruth: item.groundTruth,
              latencyMs: res.latencyMs,
              audioDurationMs: audioDurationMs > 0 ? audioDurationMs : undefined,
              rtf,
              checks,
              categoryScores,
              overallScore,
              hallucinationsCritical: scored.hallucinationsCritical,
              hallucinationsMinor: scored.hallucinationsMinor,
              hallucinationsPerMinute: scored.hallucinationsPerMinute,
              minorContradictions: scored.minorContradictions,
              asrUsage: res.usage,
              asrCostUsd: asrCost?.costUsd,
              asrCostEstimated: asrCost?.estimated,
              judgeUsage: judgeResponse.usage,
              judgeCostUsd: judgeCost?.costUsd
            };

            appendCheckpoint(runId, evaluation, verdict);
            completed += 1;
            console.log(
              `   [${completed}/${asrResults.length}] ✓ ${res.modelId} on ${item.id} (Score: ${overallScore.toFixed(1)}%)`
            );
            return evaluation;
          });

        const settled = yield* Effect.all(asrResults.map(judgeTask), {
          concurrency: judgeConcurrency
        });
        const evaluations = settled.filter((e): e is SampleEvaluation => e !== null);
        if (skipped.length > 0) {
          // Skipped samples are deliberately absent from the checkpoint, so
          // running the same eval again judges exactly those and reuses the rest.
          console.warn(
            `\n⚠️  ${skipped.length} sample(s) skipped after repeated judge failures: ${skipped.join(", ")}`
          );
          console.warn(
            `   Re-run 'kikitori eval ${datasetName} --run ${runId}' to retry only these; everything already judged is reused.`
          );
        }

        // Aggregate token consumption and cost per model
        const usageSummary = buildRunUsageSummary(evaluations, config, judgeModel);

        // Build Leaderboard
        const leaderboard: LeaderboardEntry[] = [];
        for (const mId of models) {
          const modelEvals = evaluations.filter((e) => e.modelId === mId);
          const modelResults = asrResults.filter((r) => r.modelId === mId);
          const sampleCount = modelEvals.length;
          const totalLatency = modelResults.reduce((acc, r) => acc + r.latencyMs, 0);
          const avgLatency =
            sampleCount > 0
              ? Math.round(totalLatency / sampleCount)
              : 0;

          const totalAudioDuration = modelEvals.reduce((acc, e) => acc + (e.audioDurationMs ?? 0), 0);
          const averageRtf =
            totalAudioDuration > 0
              ? Math.round((totalLatency / totalAudioDuration) * 1000) / 1000
              : undefined;

          const axes: EvaluationAxis[] = [...EVALUATION_AXES];

          const catAvgScores = {} as Record<EvaluationAxis, number>;
          for (const ax of axes) {
            const sumScore = modelEvals.reduce(
              (acc, e) => acc + (e.categoryScores[ax]?.scorePercent ?? 0),
              0
            );
            catAvgScores[ax] = sampleCount > 0 ? Math.round((sumScore / sampleCount) * 10) / 10 : 0;
          }

          const avgOverall =
            sampleCount > 0
              ? Math.round((modelEvals.reduce((acc, e) => acc + e.overallScore, 0) / sampleCount) * 10) / 10
              : 0;

          const displayName = config.models[mId]?.displayName ?? mId;

          const modelUsage = usageSummary.perModel.find((m) => m.modelId === mId);

          leaderboard.push({
            modelId: mId,
            displayName,
            overallScore: avgOverall,
            categoryScores: catAvgScores,
            sampleCount,
            averageLatencyMs: avgLatency,
            averageRtf,
            asrCostUsd: modelUsage?.asrCostUsd,
            judgeCostUsd: modelUsage?.judgeCostUsd,
            totalCostUsd: modelUsage?.totalCostUsd
          });
        }

        // Sort leaderboard by overallScore desc
        leaderboard.sort((a, b) => b.overallScore - a.overallScore);

        const report: BenchmarkReport = {
          runId,
          datasetName,
          timestamp: new Date().toISOString(),
          judgeModel,
          evaluations,
          leaderboard,
          conditions: {
            judge: {
              provider: useMockJudge ? "mock" : config.judge.provider,
              model: judgeModel,
              endpoint: config.judge.endpoint,
              temperature: config.judge.temperature
            },
            weights: config.weights,
            sampleCount: new Set(evaluations.map((e) => e.sampleId)).size,
            models: asrConditions.slice()
          },
          usageSummary,
          analytics: buildRunAnalytics(evaluations, items, config)
        };

        // Save report to runs/<run_id>/evaluation_report.json
        const runDir = path.resolve(process.cwd(), "runs", runId);
        if (!fs.existsSync(runDir)) {
          fs.mkdirSync(runDir, { recursive: true });
        }
        fs.writeFileSync(
          path.resolve(runDir, "evaluation_report.json"),
          JSON.stringify(report, null, 2),
          "utf-8"
        );

        return report;
      });
    }
  })
);
