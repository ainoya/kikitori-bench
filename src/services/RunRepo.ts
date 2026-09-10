import * as fs from "node:fs";
import * as path from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { AsrBatchRunSchema, type AsrBatchRun } from "../schemas/asr.js";
import { BenchmarkReportSchema, type BenchmarkReport } from "../schemas/judge.js";
import type { RunSummary } from "../schemas/compare.js";
import { RunNotFoundError, ValidationError } from "../errors.js";

const ASR_RESULTS_FILE = "asr_results.json";
const EVALUATION_REPORT_FILE = "evaluation_report.json";

export interface RunRepoShape {
  getRunsDir(): string;
  getRunDir(runId: string): string;
  /** Newest first, so the UI can open the most recent run without an argument. */
  listRuns(): Effect.Effect<readonly RunSummary[], ValidationError>;
  loadAsrRun(runId: string): Effect.Effect<AsrBatchRun, RunNotFoundError | ValidationError>;
  /** `undefined` when the run has not been judged yet - not an error. */
  loadReport(runId: string): Effect.Effect<BenchmarkReport | undefined, ValidationError>;
}

const readJson = (filePath: string): Effect.Effect<unknown, ValidationError> =>
  Effect.try({
    try: () => JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown,
    catch: (cause) =>
      new ValidationError({
        message: `Failed to read JSON at ${filePath}: ${String(cause)}`,
        details: cause,
      }),
  });

const decode = <A, I>(
  schema: Schema.Schema<A, I>,
  input: unknown,
  filePath: string,
): Effect.Effect<A, ValidationError> => {
  const decoded = Schema.decodeUnknownEither(schema)(input);
  if (decoded._tag === "Left") {
    return Effect.fail(
      new ValidationError({
        message: `Schema validation failed for ${filePath}: ${JSON.stringify(decoded.left)}`,
        details: decoded.left,
      }),
    );
  }
  return Effect.succeed(decoded.right);
};

export class RunRepo extends Context.Tag("RunRepo")<RunRepo, RunRepoShape>() {}

export const RunRepoLive = Layer.succeed(
  RunRepo,
  RunRepo.of({
    getRunsDir(): string {
      return path.resolve(process.cwd(), "runs");
    },

    getRunDir(runId: string): string {
      return path.resolve(this.getRunsDir(), runId);
    },

    listRuns() {
      return Effect.gen(this, function* () {
        const runsDir = this.getRunsDir();
        if (!fs.existsSync(runsDir)) return [];

        // Holding the run itself is enough to be a run directory; `existsSync`
        // follows symlinks, so a run archived elsewhere and linked in counts.
        const runIds = fs
          .readdirSync(runsDir)
          .filter((name) => fs.existsSync(path.resolve(runsDir, name, ASR_RESULTS_FILE)))
          .sort()
          .reverse();

        const summaries: RunSummary[] = [];
        for (const runId of runIds) {
          const asrPath = path.resolve(runsDir, runId, ASR_RESULTS_FILE);
          // A half-written run must not hide every other run from the picker.
          const batch = yield* readJson(asrPath).pipe(
            Effect.flatMap((raw) => decode(AsrBatchRunSchema, raw, asrPath)),
            Effect.catchAll(() => Effect.succeed(undefined)),
          );
          if (!batch) continue;

          summaries.push({
            runId: batch.runId,
            datasetName: batch.datasetName,
            timestamp: batch.timestamp,
            modelIds: batch.models,
            sampleCount: new Set(batch.results.map((r) => r.sampleId)).size,
            evaluated: fs.existsSync(path.resolve(runsDir, runId, EVALUATION_REPORT_FILE)),
          });
        }
        return summaries;
      });
    },

    loadAsrRun(runId: string) {
      return Effect.gen(this, function* () {
        const asrPath = path.resolve(this.getRunDir(runId), ASR_RESULTS_FILE);
        if (!fs.existsSync(asrPath)) {
          return yield* Effect.fail(new RunNotFoundError({ runId, path: asrPath }));
        }
        const raw = yield* readJson(asrPath);
        return yield* decode(AsrBatchRunSchema, raw, asrPath);
      });
    },

    loadReport(runId: string) {
      return Effect.gen(this, function* () {
        const reportPath = path.resolve(this.getRunDir(runId), EVALUATION_REPORT_FILE);
        if (!fs.existsSync(reportPath)) return undefined;
        const raw = yield* readJson(reportPath);
        return yield* decode(BenchmarkReportSchema, raw, reportPath);
      });
    },
  }),
);
