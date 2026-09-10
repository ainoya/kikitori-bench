import * as http from "node:http";
import { Effect } from "effect";
import { ReviewServerError } from "../errors.js";
import { DatasetRepo } from "../services/DatasetRepo.js";
import { RunRepo } from "../services/RunRepo.js";
import { buildComparisonView } from "./compare-data.js";
import {
  resolveWithinDir,
  sendJson,
  sendText,
  serveAudioFile,
  serveStaticPage,
} from "./http-helpers.js";
import type { AppConfig } from "../schemas/config.js";

export interface CompareServerOptions {
  port: number;
  /**
   * Runs opened on load, merged into one set of columns when there is more
   * than one. The UI can switch to any single run from the picker.
   */
  runIds: readonly string[];
  config: AppConfig;
}

export const startCompareServer = (options: CompareServerOptions) =>
  Effect.gen(function* () {
    const runRepo = yield* RunRepo;
    const datasetRepo = yield* DatasetRepo;
    const { port, runIds, config } = options;

    // The UI is read-only, so every request can be answered from the two repos
    // without any run-scoped state on the server. Failures are turned into a
    // one-line message here: a fiber stack trace is noise in a fetch response.
    const runtime = {
      listRuns: () => Effect.runPromise(runRepo.listRuns()),
      loadView: (ids: readonly string[]) =>
        Effect.runPromise(
          buildComparisonView(ids, config).pipe(
            Effect.provideService(RunRepo, runRepo),
            Effect.provideService(DatasetRepo, datasetRepo),
            Effect.map((view) => ({ view, error: undefined })),
            Effect.catchTags({
              RunNotFoundError: (error) =>
                Effect.succeed({
                  view: undefined,
                  error: `Run not found: ${error.runId}`,
                }),
              ValidationError: (error) => Effect.succeed({ view: undefined, error: error.message }),
            }),
          ),
        ),
    };

    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = parsedUrl.pathname;

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname === "/" || pathname === "/index.html") {
        serveStaticPage(res, "compare.html");
        return;
      }

      // GET /api/runs -> run picker contents, newest first
      if (pathname === "/api/runs" && req.method === "GET") {
        runtime
          .listRuns()
          .then((runs) => sendJson(res, 200, { defaultRunIds: runIds, runs }))
          .catch((err) => sendJson(res, 500, { error: String(err) }));
        return;
      }

      // GET /api/comparison?run=...&run=... -> ground truth + every hypothesis,
      // merged across the given runs
      if (pathname === "/api/comparison" && req.method === "GET") {
        const requested = parsedUrl.searchParams.getAll("run");
        const ids = requested.length > 0 ? requested : runIds;
        runtime
          .loadView(ids)
          .then((result) =>
            result.view
              ? sendJson(res, 200, result.view)
              : sendJson(res, 404, { error: result.error }),
          )
          .catch((err) => sendJson(res, 500, { error: String(err) }));
        return;
      }

      // GET /api/audio?dataset=...&path=...
      if (pathname === "/api/audio" && req.method === "GET") {
        const datasetName = parsedUrl.searchParams.get("dataset");
        const relAudioPath = parsedUrl.searchParams.get("path");
        if (!datasetName || !relAudioPath) {
          sendText(res, 400, "Missing 'dataset' or 'path' query parameter");
          return;
        }
        const audioFullPath = resolveWithinDir(
          datasetRepo.getDatasetDir(datasetName),
          relAudioPath,
        );
        if (!audioFullPath) {
          sendText(res, 400, "Invalid 'path' query parameter");
          return;
        }
        serveAudioFile(req, res, audioFullPath);
        return;
      }

      sendText(res, 404, "Not Found");
    });

    yield* Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          server.listen(port, () => {
            const query = runIds.map((id) => `run=${encodeURIComponent(id)}`).join("&");
            console.log(
              `\nGT vs models comparison view is running at: http://localhost:${port}?${query}`,
            );
            console.log(`   Press Ctrl+C to stop the comparison server.\n`);
            resolve();
          });
          server.on("error", reject);
        }),
      catch: (cause) =>
        new ReviewServerError({
          port,
          message: `Failed to start comparison server on port ${port}`,
          cause,
        }),
    });

    return yield* Effect.never;
  });
