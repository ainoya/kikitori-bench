#!/usr/bin/env node
import { Command } from "commander";
import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import { loadConfig } from "./config.js";
import { DatasetRepo, DatasetRepoLive } from "./services/DatasetRepo.js";
import { Drafter, DrafterLive, targetKeyPointCount } from "./services/Drafter.js";
import { AsrRunner, AsrRunnerLive } from "./services/AsrRunner.js";
import { JudgeService, JudgeServiceLive } from "./services/JudgeService.js";
import { Reporter, ReporterLive } from "./services/Reporter.js";
import { startReviewServer } from "./review/server.js";
import { buildRunUsageSummary } from "./utils/cost.js";
import { buildRunAnalytics } from "./services/Analytics.js";
import { publishRun } from "./services/Publisher.js";
import { DEFAULT_F_BETA, EVALUATION_AXES, scoreVerdict } from "./judge/scoring.js";
import { verdictFromChecks } from "./judge/rescore.js";
import { getTokenizer, scoreProperNouns } from "./judge/lexical.js";
import {
  buildAuditWorksheet,
  measureJudgeConsistency,
  scoreAuditWorksheet,
  writeConsistency,
  type AuditEntry
} from "./services/JudgeAudit.js";
import * as YAML from "yaml";
import { getAudioDurationMs } from "./utils/audio.js";
import type { DatasetItem } from "./schemas/dataset.js";
import type { AsrBatchRun, AsrResult } from "./schemas/asr.js";
import type { BenchmarkReport } from "./schemas/judge.js";
import type { Locale } from "./i18n/index.js";

// Load environment variables from .env
dotenv.config();

const program = new Command();

program
  .name("kikitori")
  .description("Private speech recognition benchmark with LLM-as-a-judge (Codex App Server / GPT-5.6 Luna)")
  .version("0.1.0");

// Compound live layer containing all services
const MainLive = Layer.mergeAll(
  DatasetRepoLive,
  DrafterLive,
  AsrRunnerLive,
  JudgeServiceLive,
  ReporterLive
);

type MainServices = Layer.Layer.Success<typeof MainLive>;

// Helper to run an Effect workflow
const runEffect = <A, E>(effect: Effect.Effect<A, E, MainServices>): Promise<A> => {
  return Effect.runPromise(Effect.provide(effect, MainLive));
};

/**
 * Keep only samples within a duration cap. Providers differ in what they accept
 * (Meta Muse rejects audio over 10 minutes), so comparing them on a mixed set
 * scores an API limit rather than transcription quality.
 */
const applyDurationCap = (
  items: readonly DatasetItem[],
  datasetDir: string,
  maxDurationSec: number | undefined
) =>
  Effect.gen(function* () {
    if (maxDurationSec === undefined) return { items: [...items], excluded: 0 };
    const measured = yield* Effect.all(
      items.map((item) =>
        Effect.promise(() => getAudioDurationMs(path.resolve(datasetDir, item.audioPath))).pipe(
          Effect.map((durationMs) => ({ item, durationMs }))
        )
      ),
      { concurrency: 8 }
    );
    const kept = measured.filter((m) => m.durationMs <= maxDurationSec * 1000);
    return { items: kept.map((m) => m.item), excluded: measured.length - kept.length };
  });

const parseLocale = (val?: string): Locale | undefined => {
  if (val === "ja" || val === "en") return val;
  return undefined;
};

// ==========================================
// DATASET SUBCOMMANDS
// ==========================================
const datasetCmd = program.command("dataset").description("Manage private benchmark datasets");

datasetCmd
  .command("init <name>")
  .description("Initialize a new dataset directory and manifest")
  .option("-d, --description <desc>", "Dataset description")
  .action(async (name: string, opts: { description?: string }) => {
    await runEffect(
      Effect.gen(function* () {
        const repo = yield* DatasetRepo;
        yield* repo.initDataset(name, opts.description);
        console.log(`✅ Dataset '${name}' initialized at: datasets/${name}`);
        console.log(`📁 Place your private audio files in: datasets/${name}/audio/`);
        console.log(`📝 Next, run: 'kikitori dataset scan ${name}' or 'kikitori review ${name}'`);
      })
    );
  });

datasetCmd
  .command("import-journal [sourceDir]")
  .description(
    "Import audio and transcripts from an Obsidian vault of voice-journal notes"
  )
  .option("-n, --name <name>", "Target dataset name", "ayumi_journal_ja")
  .action(async (sourceDir: string | undefined, opts: { name: string }) => {
    const { importFromVoiceJournal } = await import("./dataset/obsidian-importer.js");
    // No default: the vault path is personal, so it is supplied per machine
    // rather than baked into the repository.
    const targetDir = sourceDir ?? process.env["JOURNAL_VAULT_DIR"];
    if (!targetDir) {
      console.error(
        "❌ Pass the vault directory as an argument, or set JOURNAL_VAULT_DIR in .env"
      );
      console.error("   e.g. pnpm kikitori dataset import-journal ~/vault/journal/2026");
      return;
    }

    console.log(`🚀 Importing Gemini 3.x Flash notes from: ${targetDir}`);
    console.log(`📦 Target dataset: ${opts.name}...`);

    await runEffect(
      Effect.gen(function* () {
        const res = yield* importFromVoiceJournal({
          sourceDir: targetDir,
          datasetName: opts.name
        });

        console.log(`\n🎉 Import completed successfully!`);
        console.log(`   Scanned notes: ${res.totalScanned}`);
        console.log(`   Matched Gemini 3.x Flash notes: ${res.matchedNotes}`);
        console.log(`   Imported valid items: ${res.importedItems}`);
        if (res.skippedMissingAudio > 0) {
          console.log(`   Skipped (missing audio): ${res.skippedMissingAudio}`);
        }
        console.log(`   Dataset location: datasets/${opts.name}`);
        console.log(`   Manifest: datasets/${opts.name}/dataset.yaml`);
        console.log(`\nNext step: Run 'kikitori review ${opts.name}' to inspect or edit in Web UI.`);
      })
    );
  });

datasetCmd
  .command("scan <name>")
  .description("Scan datasets/<name>/audio/ for new audio files and update dataset.yaml")
  .action(async (name: string) => {
    await runEffect(
      Effect.gen(function* () {
        const repo = yield* DatasetRepo;
        const res = yield* repo.scanNewAudioFiles(name);
        console.log(`🔍 Scanned dataset '${name}':`);
        console.log(`   Added ${res.added} new audio files (Total items: ${res.total})`);
      })
    );
  });

datasetCmd
  .command("refine <name>")
  .description(
    "Re-derive key_points from the verified ground truth at a granularity fine enough to score long clips"
  )
  .option("-c, --concurrency <n>", "Concurrent API requests", "3")
  .option("--dry-run", "Show the proposed key points without writing dataset.yaml")
  .action(async (name: string, opts: { concurrency: string; dryRun?: boolean }) => {
    await runEffect(
      Effect.gen(function* () {
        const repo = yield* DatasetRepo;
        const drafter = yield* Drafter;
        const manifest = yield* repo.loadManifest(name);
        const datasetDir = repo.getDatasetDir(name);

        // The transcript alone cannot tell the model how long the recording was,
        // so the target count is computed here from the audio duration.
        const targets = yield* Effect.all(
          manifest.items.map((item) =>
            Effect.gen(function* () {
              const durationMs = yield* Effect.promise(() =>
                getAudioDurationMs(path.resolve(datasetDir, item.audioPath))
              );
              return {
                item,
                durationMs,
                target: targetKeyPointCount(durationMs, item.groundTruth)
              };
            })
          ),
          { concurrency: 4 }
        );

        const before = targets.reduce((acc, t) => acc + t.item.keyPoints.length, 0);
        console.log(
          `🔎 Refining key points for ${targets.length} items (currently ${before} points, target ~${targets.reduce((a, t) => a + t.target, 0)})...`
        );

        if (!opts.dryRun) {
          const backup = path.resolve(datasetDir, `dataset.yaml.bak-${Date.now()}`);
          fs.copyFileSync(path.resolve(datasetDir, "dataset.yaml"), backup);
          console.log(`   Backup written to ${backup}`);
        }

        let after = 0;
        yield* Effect.all(
          targets.map((t) =>
            Effect.gen(function* () {
              if (!t.item.groundTruth.trim()) return;
              const points = yield* drafter
                .refineKeyPoints(t.item.groundTruth, t.target, t.item.id)
                .pipe(
                  Effect.catchAll((err) => {
                    console.error(`   ✗ ${t.item.id}: ${err.message}`);
                    return Effect.succeed(t.item.keyPoints);
                  })
                );
              after += points.length;
              console.log(
                `   ✓ ${t.item.id} (${(t.durationMs / 1000).toFixed(0)}s): ${t.item.keyPoints.length} → ${points.length} points (target ${t.target})`
              );
              if (!opts.dryRun) {
                yield* repo.updateItem(name, t.item.id, { keyPoints: points });
              }
            })
          ),
          { concurrency: parseInt(opts.concurrency, 10) || 3 }
        );

        console.log(`\n🎉 Key points: ${before} → ${after}${opts.dryRun ? " (dry run, nothing written)" : ""}`);
      })
    );
  });

datasetCmd
  .command("draft <name>")
  .description("Generate draft transcripts, expected terms, and key points using Gemini 3.8 Flash")
  .option("-c, --concurrency <n>", "Concurrent API requests", "2")
  .action(async (name: string, opts: { concurrency: string }) => {
    await runEffect(
      Effect.gen(function* () {
        const repo = yield* DatasetRepo;
        const drafter = yield* Drafter;
        yield* repo.scanNewAudioFiles(name);
        const manifest = yield* repo.loadManifest(name);

        const unverified = manifest.items.filter((it) => !it.verified);
        if (unverified.length === 0) {
          console.log(`✨ All ${manifest.items.length} items in '${name}' are already verified!`);
          return;
        }

        console.log(`🚀 Generating Gemini drafts for ${unverified.length} unverified audio files...`);
        const datasetDir = repo.getDatasetDir(name);
        const concurrency = parseInt(opts.concurrency, 10) || 2;

        const draftTask = (item: (typeof unverified)[0]) =>
          Effect.gen(function* () {
            const fullPath = path.resolve(datasetDir, item.audioPath);
            console.log(`   Drafting: ${item.id} (${item.audioPath})...`);
            try {
              const draft = yield* drafter.draftFromAudio(fullPath, item.id);
              yield* repo.updateItem(name, item.id, {
                draftTranscript: draft.transcript,
                groundTruth: item.groundTruth || draft.transcript,
                expectedTerms: draft.expectedTerms,
                keyPoints: draft.keyPoints
              });
              console.log(`   ✓ Drafted ${item.id}`);
            } catch (err) {
              console.error(`   ✗ Failed drafting for ${item.id}: ${String(err)}`);
            }
          });

        yield* Effect.all(unverified.map(draftTask), { concurrency });
        console.log(`\n🎉 Drafting complete! Run 'kikitori review ${name}' to inspect and approve in the Web UI.`);
      })
    );
  });

// ==========================================
// REVIEW WEB UI
// ==========================================
program
  .command("review <name>")
  .description("Launch local Web UI for audio listening, ground truth editing, and verification")
  .option("-p, --port <port>", "Port number for review server")
  .action(async (name: string, opts: { port?: string }) => {
    await runEffect(
      Effect.gen(function* () {
        const config = yield* loadConfig();
        const repo = yield* DatasetRepo;
        yield* repo.scanNewAudioFiles(name);

        const port = opts.port ? parseInt(opts.port, 10) : config.review.port;
        yield* startReviewServer({ port, datasetName: name });
      })
    );
  });

// ==========================================
// RUN ASR TRANSCRIPTION
// ==========================================
program
  .command("run <name>")
  .description("Run target ASR models on dataset audio files")
  .option("-m, --models <models...>", "List of model IDs to run (e.g. gemini-flash whisper-1)")
  .option("-c, --concurrency <n>", "Concurrency for ASR requests")
  .option("-l, --limit <n>", "Limit the number of items to run")
  .option("-d, --max-duration <sec>", "Skip samples longer than this many seconds")
  .option("--all", "Run on all items, including unverified ones")
  .action(async (name: string, opts: { models?: string[]; concurrency?: string; limit?: string; maxDuration?: string; all?: boolean }) => {
    await runEffect(
      Effect.gen(function* () {
        const config = yield* loadConfig();
        const repo = yield* DatasetRepo;
        const runner = yield* AsrRunner;

        const manifest = yield* repo.loadManifest(name);
        let targetItems = opts.all ? manifest.items : manifest.items.filter((i) => i.verified);

        const maxDurationSec = opts.maxDuration ? parseInt(opts.maxDuration, 10) : undefined;
        const capped = yield* applyDurationCap(targetItems, repo.getDatasetDir(name), maxDurationSec);
        targetItems = capped.items;
        if (capped.excluded > 0) {
          console.log(`   ⏱️  ${capped.excluded} sample(s) longer than ${maxDurationSec}s excluded`);
        }

        if (opts.limit) {
          const limitCount = parseInt(opts.limit, 10);
          if (limitCount > 0) {
            targetItems = targetItems.slice(0, limitCount);
          }
        }

        if (targetItems.length === 0) {
          console.log(`⚠️ No verified items found in dataset '${name}'.`);
          console.log(`   Run 'kikitori review ${name}' to verify items, or pass '--all' to run on all items.`);
          return;
        }

        const modelIds = opts.models ?? Object.keys(config.models);
        console.log(`🎙️ Running ASR models [${modelIds.join(", ")}] on ${targetItems.length} items in '${name}'...`);

        const concurrency = opts.concurrency ? parseInt(opts.concurrency, 10) : config.judge.concurrency;
        const batchRun = yield* runner.runBatch(name, targetItems, modelIds, config, concurrency);

        console.log(`\n✅ ASR transcription complete!`);
        console.log(`   Run ID: ${batchRun.runId}`);
        console.log(`   Results saved to: runs/${batchRun.runId}/asr_results.json`);
        console.log(`\nNext, evaluate using the judge: 'kikitori eval ${name} --run ${batchRun.runId}'`);
      })
    );
  });


program
  .command("repair <runId>")
  .description("Re-run the ASR requests that failed in a run, then drop their stale judgements")
  .option("-c, --concurrency <n>", "Concurrency for the retried requests", "2")
  .action(async (runId: string, opts: { concurrency: string }) => {
    await runEffect(
      Effect.gen(function* () {
        const config = yield* loadConfig();
        const repo = yield* DatasetRepo;
        const runner = yield* AsrRunner;

        const runDir = path.resolve(process.cwd(), "runs", runId);
        const asrPath = path.resolve(runDir, "asr_results.json");
        if (!fs.existsSync(asrPath)) {
          console.error(`❌ Cannot find ASR results at: ${asrPath}`);
          return;
        }
        const asrRun = JSON.parse(fs.readFileSync(asrPath, "utf-8")) as AsrBatchRun;
        const failed = asrRun.results.filter((r) => r.error !== undefined);
        if (failed.length === 0) {
          console.log("✨ No failed ASR results to repair.");
          return;
        }

        const manifest = yield* repo.loadManifest(asrRun.datasetName);
        const itemMap = new Map(manifest.items.map((it) => [it.id, it]));
        const datasetDir = repo.getDatasetDir(asrRun.datasetName);
        console.log(`🔧 Retrying ${failed.length} failed ASR request(s) in ${runId}...`);

        const repaired = new Map<string, AsrResult>();
        yield* Effect.all(
          failed.map((result) =>
            Effect.gen(function* () {
              const item = itemMap.get(result.sampleId);
              if (!item) return;
              const adapter = yield* runner.createAdapter(result.modelId, config);
              const audioPath = path.resolve(datasetDir, item.audioPath);
              const outcome = yield* adapter.transcribe(audioPath, item.id).pipe(
                Effect.map((res) => ({
                  ...result,
                  hypothesis: res.hypothesis,
                  latencyMs: res.latencyMs,
                  rtf:
                    result.audioDurationMs && result.audioDurationMs > 0
                      ? Math.round((res.latencyMs / result.audioDurationMs) * 1000) / 1000
                      : undefined,
                  timestamp: new Date().toISOString(),
                  usage: res.usage,
                  error: undefined
                })),
                Effect.catchAll((err) =>
                  Effect.sync(() => {
                    console.error(`   ✗ still failing: ${result.modelId} / ${result.sampleId}: ${err.message}`);
                    return result;
                  })
                )
              );
              if (outcome.error === undefined) {
                repaired.set(`${result.modelId}::${result.sampleId}`, outcome);
                console.log(`   ✓ ${result.modelId} / ${result.sampleId}`);
              }
            })
          ),
          { concurrency: parseInt(opts.concurrency, 10) || 2 }
        );

        if (repaired.size === 0) {
          console.log("⚠️  Nothing could be repaired.");
          return;
        }

        const merged: AsrBatchRun = {
          ...asrRun,
          results: asrRun.results.map(
            (r) => repaired.get(`${r.modelId}::${r.sampleId}`) ?? r
          )
        };
        fs.writeFileSync(asrPath, JSON.stringify(merged, null, 2), "utf-8");

        // The judge already scored these as empty transcripts, so those
        // checkpoint entries have to go or the re-run would reuse them.
        const checkpoint = path.resolve(runDir, "evaluations.jsonl");
        if (fs.existsSync(checkpoint)) {
          const kept = fs
            .readFileSync(checkpoint, "utf-8")
            .split("\n")
            .filter((line) => {
              if (!line.trim()) return false;
              try {
                const entry = JSON.parse(line) as { evaluation?: { modelId: string; sampleId: string } };
                const key = `${entry.evaluation?.modelId}::${entry.evaluation?.sampleId}`;
                return !repaired.has(key);
              } catch {
                return false;
              }
            });
          fs.writeFileSync(checkpoint, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf-8");
        }

        console.log(`\n🎉 Repaired ${repaired.size} result(s).`);
        console.log(`   Next: pnpm kikitori eval ${asrRun.datasetName} --run ${runId}`);
      })
    );
  });

// ==========================================
// EVAL WITH CODEX APP SERVER (LUNA)
// ==========================================
program
  .command("eval <name>")
  .alias("evaluate")
  .description("Evaluate ASR transcripts against Ground Truth using Codex App Server (GPT-5.6 Luna)")
  .requiredOption("-r, --run <runId>", "Run ID to evaluate (from 'kikitori run')")
  .option("-c, --concurrency <n>", "Concurrent judge turns")
  .option("--mock-judge", "Use offline mock judge for testing")
  .option("--lang <lang>", "Report language (en or ja)")
  .action(async (name: string, opts: { run: string; concurrency?: string; mockJudge?: boolean; lang?: string }) => {
    await runEffect(
      Effect.gen(function* () {
        const config = yield* loadConfig();
        const repo = yield* DatasetRepo;
        const judge = yield* JudgeService;
        const reporter = yield* Reporter;
        const locale = parseLocale(opts.lang);

        const manifest = yield* repo.loadManifest(name);
        const runDir = path.resolve(process.cwd(), "runs", opts.run);
        const asrPath = path.resolve(runDir, "asr_results.json");

        if (!fs.existsSync(asrPath)) {
          console.error(`❌ Cannot find ASR results at: ${asrPath}`);
          return;
        }

        const rawData = fs.readFileSync(asrPath, "utf-8");
        const asrRun = JSON.parse(rawData) as AsrBatchRun;

        console.log(`⚖️ Evaluating run '${opts.run}' with Codex App Server (model: ${config.judge.model})...`);
        const report = yield* judge.evaluateRun(
          opts.run,
          name,
          manifest.items,
          asrRun.results,
          opts.concurrency
            ? { ...config, judge: { ...config.judge, concurrency: parseInt(opts.concurrency, 10) } }
            : config,
          opts.mockJudge,
          asrRun.conditions
        );

        reporter.renderConsoleLeaderboard(report, locale);
        const mdPath = yield* reporter.generateMarkdownReport(report, locale);
        console.log(`📄 Detailed report generated at: ${mdPath}`);
      })
    );
  });

// ==========================================
// BENCHMARK (RUN + EVAL PIPELINE)
// ==========================================
program
  .command("benchmark <name>")
  .description("Run complete pipeline: ASR execution -> Codex App Server evaluation -> Leaderboard report")
  .option("-m, --models <models...>", "List of model IDs to benchmark")
  .option("-c, --concurrency <n>", "Concurrency")
  .option("-l, --limit <n>", "Limit the number of items to benchmark")
  .option("-d, --max-duration <sec>", "Skip samples longer than this many seconds")
  .option("--all", "Benchmark on all items, including unverified")
  .option("--mock-judge", "Use offline mock judge for testing")
  .option("--lang <lang>", "Report language (en or ja)")
  .action(async (name: string, opts: { models?: string[]; concurrency?: string; limit?: string; maxDuration?: string; all?: boolean; mockJudge?: boolean; lang?: string }) => {
    await runEffect(
      Effect.gen(function* () {
        const config = yield* loadConfig();
        const repo = yield* DatasetRepo;
        const runner = yield* AsrRunner;
        const judge = yield* JudgeService;
        const reporter = yield* Reporter;
        const locale = parseLocale(opts.lang);

        const manifest = yield* repo.loadManifest(name);
        let targetItems = opts.all ? manifest.items : manifest.items.filter((i) => i.verified);

        const maxDurationSec = opts.maxDuration ? parseInt(opts.maxDuration, 10) : undefined;
        const capped = yield* applyDurationCap(targetItems, repo.getDatasetDir(name), maxDurationSec);
        targetItems = capped.items;
        if (capped.excluded > 0) {
          console.log(`   ⏱️  ${capped.excluded} sample(s) longer than ${maxDurationSec}s excluded`);
        }

        if (opts.limit) {
          const limitCount = parseInt(opts.limit, 10);
          if (limitCount > 0) {
            targetItems = targetItems.slice(0, limitCount);
          }
        }

        if (targetItems.length === 0) {
          console.log(`⚠️ No verified items found in dataset '${name}'. Pass '--all' or run 'kikitori review ${name}'.`);
          return;
        }

        const modelIds = opts.models ?? Object.keys(config.models);
        console.log(`🚀 Launching full benchmark on '${name}' for models [${modelIds.join(", ")}]...`);

        const concurrency = opts.concurrency ? parseInt(opts.concurrency, 10) : config.judge.concurrency;
        // -c applies to both phases: ASR requests and judge turns.
        const runConfig = opts.concurrency
          ? { ...config, judge: { ...config.judge, concurrency } }
          : config;
        const batchRun = yield* runner.runBatch(name, targetItems, modelIds, runConfig, concurrency);

        console.log(`\n⚖️ Running LLM-as-a-judge evaluation with ${config.judge.model}...`);
        const judged = yield* judge.evaluateRun(
          batchRun.runId,
          name,
          manifest.items,
          batchRun.results,
          runConfig,
          opts.mockJudge,
          batchRun.conditions
        );

        // The duration cap is a property of the run, not of any one model, so it
        // is stamped onto the report after judging rather than threaded through.
        const report: BenchmarkReport =
          maxDurationSec !== undefined && judged.conditions
            ? {
                ...judged,
                conditions: {
                  ...judged.conditions,
                  maxDurationSec,
                  excludedByDuration: capped.excluded
                }
              }
            : judged;
        fs.writeFileSync(
          path.resolve(process.cwd(), "runs", batchRun.runId, "evaluation_report.json"),
          JSON.stringify(report, null, 2),
          "utf-8"
        );

        reporter.renderConsoleLeaderboard(report, locale);
        const mdPath = yield* reporter.generateMarkdownReport(report, locale);
        console.log(`📄 Detailed report generated at: ${mdPath}`);
      })
    );
  });



program
  .command("rescore <runId>")
  .description("Re-apply the current scoring formula and weights to a finished run (no judge calls)")
  .option("--lang <lang>", "Report language (en or ja)")
  .action(async (runId: string, opts: { lang?: string }) => {
    await runEffect(
      Effect.gen(function* () {
        const config = yield* loadConfig();
        const repo = yield* DatasetRepo;
        const reporter = yield* Reporter;
        const locale = parseLocale(opts.lang);

        const reportPath = path.resolve(process.cwd(), "runs", runId, "evaluation_report.json");
        if (!fs.existsSync(reportPath)) {
          console.error(`❌ Cannot find evaluation report at: ${reportPath}`);
          return;
        }
        const stored = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as BenchmarkReport;
        const manifest = yield* repo.loadManifest(stored.datasetName);
        const itemMap = new Map(manifest.items.map((it) => [it.id, it]));

        const tokenizer = yield* Effect.promise(() => getTokenizer());
        const evaluations = stored.evaluations.map((evaluation) => {
          const item = itemMap.get(evaluation.sampleId);
          if (!item) return evaluation;
          const scored = scoreVerdict({
            verdict: verdictFromChecks(evaluation, item),
            item,
            audioDurationMs: evaluation.audioDurationMs ?? 0,
            weights: config.weights,
            fBeta: config.scoring?.fBeta ?? DEFAULT_F_BETA,
            lexical: scoreProperNouns(tokenizer, item.groundTruth, evaluation.hypothesis)
          });
          return {
            ...evaluation,
            checks: scored.checks,
            categoryScores: scored.categoryScores,
            overallScore: scored.overallScore,
            hallucinationsCritical: scored.hallucinationsCritical,
            hallucinationsMinor: scored.hallucinationsMinor,
            hallucinationsPerMinute: scored.hallucinationsPerMinute,
            minorContradictions: scored.minorContradictions
          };
        });

        const axes = [...EVALUATION_AXES];
        const leaderboard = stored.leaderboard
          .map((entry) => {
            const modelEvals = evaluations.filter((e) => e.modelId === entry.modelId);
            const n = modelEvals.length || 1;
            const categoryScores = Object.fromEntries(
              axes.map((axis) => [
                axis,
                Math.round(
                  (modelEvals.reduce((acc, e) => acc + (e.categoryScores[axis]?.scorePercent ?? 0), 0) /
                    n) *
                    10
                ) / 10
              ])
            ) as (typeof stored.leaderboard)[number]["categoryScores"];
            return {
              ...entry,
              categoryScores,
              overallScore:
                Math.round((modelEvals.reduce((acc, e) => acc + e.overallScore, 0) / n) * 10) / 10
            };
          })
          .sort((a, b) => b.overallScore - a.overallScore);

        const report: BenchmarkReport = {
          ...stored,
          evaluations,
          leaderboard,
          ...(stored.conditions ? { conditions: { ...stored.conditions, weights: config.weights } } : {}),
          analytics: buildRunAnalytics(evaluations, manifest.items, config)
        };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

        reporter.renderConsoleLeaderboard(report, locale);
        const mdPath = yield* reporter.generateMarkdownReport(report, locale);
        console.log(`📄 Rescored report written to: ${mdPath}`);
      })
    );
  });

// ==========================================
// JUDGE RELIABILITY
// ==========================================
program
  .command("judge-consistency <runId>")
  .description("Re-judge a subsample to measure how much the judge disagrees with itself")
  .option("-n, --count <n>", "Number of (sample, model) pairs to re-judge", "20")
  .option("-s, --seed <n>", "Sampling seed", "1")
  .option("-c, --concurrency <n>", "Concurrent judge turns", "3")
  .option("--mock-judge", "Use the offline mock judge")
  .action(
    async (
      runId: string,
      opts: { count: string; seed: string; concurrency: string; mockJudge?: boolean }
    ) => {
      await runEffect(
        Effect.gen(function* () {
          const config = yield* loadConfig();
          const repo = yield* DatasetRepo;
          const reportPath = path.resolve(process.cwd(), "runs", runId, "evaluation_report.json");
          if (!fs.existsSync(reportPath)) {
            console.error(`❌ Cannot find evaluation report at: ${reportPath}`);
            return;
          }
          const report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as BenchmarkReport;
          const manifest = yield* repo.loadManifest(report.datasetName);

          console.log(
            `🔁 Re-judging ${opts.count} pairs from ${runId} to measure judge self-consistency...`
          );
          const result = yield* measureJudgeConsistency(report, manifest.items, config, {
            count: parseInt(opts.count, 10) || 20,
            seed: parseInt(opts.seed, 10) || 1,
            concurrency: parseInt(opts.concurrency, 10) || 3,
            ...(opts.mockJudge ? { useMockJudge: true } : {})
          });

          const out = writeConsistency(runId, result);
          console.log("");
          console.log(`  Pairs re-judged            : ${result.pairsCompared}`);
          console.log(`  |Δ overall score| mean     : ${result.meanAbsScoreDelta} pp`);
          console.log(`  |Δ overall score| median   : ${result.medianAbsScoreDelta} pp`);
          console.log(`  |Δ overall score| p95      : ${result.p95AbsScoreDelta} pp`);
          console.log(
            `  Term verdicts              : ${result.termAgreement.agreement}% agreement, κ=${result.termAgreement.kappa} (n=${result.termAgreement.n})`
          );
          console.log(
            `  Key point verdicts         : ${result.keyPointAgreement.agreement}% agreement, κ=${result.keyPointAgreement.kappa} (n=${result.keyPointAgreement.n})`
          );
          console.log(`  Insertion count |Δ| / sample: ${result.insertionCountDelta}`);
          console.log(`\n📄 Saved to ${out}`);
        })
      );
    }
  );

program
  .command("judge-audit <runId>")
  .description("Export a worksheet of individual checks for human labelling, or score a filled one")
  .option("-e, --export <file>", "Write a worksheet to this YAML file")
  .option("--score <file>", "Score a filled worksheet against the judge")
  .option("-n, --count <n>", "Number of checks to sample for the worksheet", "40")
  .option("-s, --seed <n>", "Sampling seed", "1")
  .action(
    async (runId: string, opts: { export?: string; score?: string; count: string; seed: string }) => {
      await runEffect(
        Effect.gen(function* () {
          if (opts.score) {
            const entries = YAML.parse(fs.readFileSync(opts.score, "utf-8")) as AuditEntry[];
            const result = scoreAuditWorksheet(entries);
            console.log(`  Labelled checks   : ${result.n} (unsure / blank: ${result.unsure})`);
            console.log(`  Judge vs human    : ${result.agreement}% agreement, κ=${result.kappa}`);
            if (result.disagreements.length > 0) {
              console.log(`\n  Disagreements:`);
              for (const d of result.disagreements) {
                console.log(
                  `   - ${d.modelId} / ${d.sampleId} / ${d.checkName}: judge=${d.judgeVerdict}, human=${d.humanVerdict}`
                );
                console.log(`     ${d.judgeReason}`);
              }
            }
            return;
          }

          const reportPath = path.resolve(process.cwd(), "runs", runId, "evaluation_report.json");
          if (!fs.existsSync(reportPath)) {
            console.error(`❌ Cannot find evaluation report at: ${reportPath}`);
            return;
          }
          const report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as BenchmarkReport;
          const worksheet = buildAuditWorksheet(
            report,
            parseInt(opts.count, 10) || 40,
            parseInt(opts.seed, 10) || 1
          );
          const target = opts.export ?? path.resolve(process.cwd(), "runs", runId, "judge_audit.yaml");
          fs.writeFileSync(target, YAML.stringify(worksheet), "utf-8");
          const tally = (pick: (e: AuditEntry) => string) => {
            const counts = new Map<string, number>();
            for (const e of worksheet) counts.set(pick(e), (counts.get(pick(e)) ?? 0) + 1);
            return [...counts].sort().map(([k, v]) => `${k} ${v}`).join(", ");
          };
          console.log(`📝 Worksheet with ${worksheet.length} checks written to ${target}`);
          console.log(`   ${tally((e) => e.modelId)}`);
          console.log(`   ${tally((e) => e.judgeVerdict)} | ${tally((e) => e.checkId.replace(/_.*/, ""))}`);
          console.log(`   Fill in "humanVerdict" with pass / fail / unsure, then run:`);
          console.log(`   pnpm kikitori judge-audit ${runId} --score ${target}`);
          yield* Effect.void;
        })
      );
    }
  );


program
  .command("publish <runId>")
  .description("Write an aggregate-only summary and standalone SVG charts for publication")
  .option("-o, --out <dir>", "Output directory", "docs")
  .option("--lang <lang>", "Report language (en or ja)")
  .action(async (runId: string, opts: { out: string; lang?: string }) => {
    await runEffect(
      Effect.gen(function* () {
        const reportPath = path.resolve(process.cwd(), "runs", runId, "evaluation_report.json");
        if (!fs.existsSync(reportPath)) {
          console.error(`❌ Cannot find evaluation report at: ${reportPath}`);
          return;
        }
        const report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as BenchmarkReport;
        const written = publishRun({
          report,
          outDir: path.resolve(process.cwd(), opts.out),
          ...(parseLocale(opts.lang) ? { locale: parseLocale(opts.lang)! } : {})
        });
        console.log("📤 Published aggregate results (no sample text, no ids):");
        for (const file of written) console.log(`   ${path.relative(process.cwd(), file)}`);
        yield* Effect.void;
      })
    );
  });

// ==========================================
// REPORT RE-GENERATION
// ==========================================
program
  .command("report <runId>")
  .description("Re-generate console leaderboard and markdown report from an existing evaluation")
  .option("--lang <lang>", "Report language (en or ja)")
  .action(async (runId: string, opts: { lang?: string }) => {
    await runEffect(
      Effect.gen(function* () {
        const config = yield* loadConfig();
        const repo = yield* DatasetRepo;
        const reporter = yield* Reporter;
        const locale = parseLocale(opts.lang);
        const runDir = path.resolve(process.cwd(), "runs", runId);
        const reportPath = path.resolve(runDir, "evaluation_report.json");

        if (!fs.existsSync(reportPath)) {
          console.error(`❌ Cannot find evaluation report at: ${reportPath}`);
          return;
        }

        const raw = fs.readFileSync(reportPath, "utf-8");
        const stored = JSON.parse(raw) as BenchmarkReport;

        // Recompute usage/cost totals so price-list edits apply to past runs too.
        const usageSummary = buildRunUsageSummary(stored.evaluations, config, stored.judgeModel);
        const leaderboard = stored.leaderboard.map((entry) => {
          const modelUsage = usageSummary.perModel.find((m) => m.modelId === entry.modelId);
          return {
            ...entry,
            asrCostUsd: modelUsage?.asrCostUsd,
            judgeCostUsd: modelUsage?.judgeCostUsd,
            totalCostUsd: modelUsage?.totalCostUsd
          };
        });
        const manifest = yield* repo.loadManifest(stored.datasetName);
        const report: BenchmarkReport = {
          ...stored,
          leaderboard,
          usageSummary,
          analytics: buildRunAnalytics(stored.evaluations, manifest.items, config)
        };

        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

        reporter.renderConsoleLeaderboard(report, locale);
        const mdPath = yield* reporter.generateMarkdownReport(report, locale);
        console.log(`📄 Report refreshed at: ${mdPath}`);
      })
    );
  });

program.parse(process.argv);
