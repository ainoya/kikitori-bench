import * as http from "node:http";
import * as path from "node:path";
import { Effect } from "effect";
import { ReviewServerError } from "../errors.js";
import { DatasetRepo } from "../services/DatasetRepo.js";
import { Drafter } from "../services/Drafter.js";
import { resolveWithinDir, sendText, serveAudioFile, serveStaticPage } from "./http-helpers.js";

export interface ReviewServerOptions {
  port: number;
  datasetName: string;
}

export const startReviewServer = (options: ReviewServerOptions) =>
  Effect.gen(function* () {
    const repo = yield* DatasetRepo;
    const drafter = yield* Drafter;
    const { port, datasetName } = options;

    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = parsedUrl.pathname;

      // Handle CORS for local requests
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // GET / -> serve index.html
      if (pathname === "/" || pathname === "/index.html") {
        serveStaticPage(res, "index.html");
        return;
      }

      // GET /api/dataset?name=...
      if (pathname === "/api/dataset" && req.method === "GET") {
        const dName = parsedUrl.searchParams.get("name") ?? datasetName;
        Effect.runPromise(repo.loadManifest(dName))
          .then((manifest) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(manifest));
          })
          .catch((err) => {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: String(err) }));
          });
        return;
      }

      // GET /api/audio?dataset=...&path=...
      if (pathname === "/api/audio" && req.method === "GET") {
        const dName = parsedUrl.searchParams.get("dataset") ?? datasetName;
        const relAudioPath = parsedUrl.searchParams.get("path");
        if (!relAudioPath) {
          sendText(res, 400, "Missing 'path' query parameter");
          return;
        }

        const audioFullPath = resolveWithinDir(repo.getDatasetDir(dName), relAudioPath);
        if (!audioFullPath) {
          sendText(res, 400, "Invalid 'path' query parameter");
          return;
        }

        serveAudioFile(req, res, audioFullPath);
        return;
      }

      // POST /api/item/update
      if (pathname === "/api/item/update" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const data = JSON.parse(body) as {
              datasetName: string;
              itemId: string;
              updates: Record<string, unknown>;
            };
            Effect.runPromise(repo.updateItem(data.datasetName, data.itemId, data.updates))
              .then((updated) => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(updated));
              })
              .catch((err) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(err) }));
              });
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
          }
        });
        return;
      }

      // POST /api/item/draft
      if (pathname === "/api/item/draft" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          try {
            const data = JSON.parse(body) as {
              datasetName: string;
              itemId: string;
            };
            Effect.runPromise(
              Effect.gen(function* () {
                const item = yield* repo.getItem(data.datasetName, data.itemId);
                const audioFullPath = path.resolve(
                  repo.getDatasetDir(data.datasetName),
                  item.audioPath,
                );
                const draft = yield* drafter.draftFromAudio(audioFullPath, item.id);
                yield* repo.updateItem(data.datasetName, item.id, {
                  draftTranscript: draft.transcript,
                  expectedTerms: draft.expectedTerms,
                  keyPoints: draft.keyPoints,
                });
                return draft;
              }),
            )
              .then((draft) => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(draft));
              })
              .catch((err) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(err) }));
              });
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
          }
        });
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    yield* Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          server.listen(port, () => {
            console.log(
              `\n🎧 Ground Truth Review Web UI is running at: http://localhost:${port}?dataset=${datasetName}`,
            );
            console.log(`   Press Ctrl+C to stop the review server.\n`);
            resolve();
          });
          server.on("error", reject);
        }),
      catch: (cause) =>
        new ReviewServerError({
          port,
          message: `Failed to start review server on port ${port}`,
          cause,
        }),
    });

    // Keep server running until interrupted
    return yield* Effect.never;
  });
