import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { DatasetRepo } from "../services/DatasetRepo.js";
import { Drafter } from "../services/Drafter.js";
import { getAudioMimeType } from "../utils/audio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        const candidatePaths = [
          path.resolve(__dirname, "static", "index.html"),
          path.resolve(__dirname, "..", "..", "src", "review", "static", "index.html")
        ];
        const htmlPath = candidatePaths.find((p) => fs.existsSync(p));
        if (htmlPath) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          fs.createReadStream(htmlPath).pipe(res);
          return;
        }
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("index.html not found");
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
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Missing 'path' query parameter");
          return;
        }

        const audioFullPath = path.resolve(repo.getDatasetDir(dName), relAudioPath);
        if (!fs.existsSync(audioFullPath)) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Audio file not found");
          return;
        }

        const stat = fs.statSync(audioFullPath);
        const totalSize = stat.size;
        const mimeType = getAudioMimeType(audioFullPath);
        const range = req.headers.range;

        // Support HTTP Range requests for seeking in audio player
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const partialstart = parts[0];
          const partialend = parts[1];
          const start = parseInt(partialstart ?? "0", 10);
          const end = partialend ? parseInt(partialend, 10) : totalSize - 1;
          const chunksize = end - start + 1;

          const file = fs.createReadStream(audioFullPath, { start, end });
          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunksize,
            "Content-Type": mimeType
          });
          file.pipe(res);
        } else {
          res.writeHead(200, {
            "Content-Length": totalSize,
            "Accept-Ranges": "bytes",
            "Content-Type": mimeType
          });
          fs.createReadStream(audioFullPath).pipe(res);
        }
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
          } catch (err) {
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
                const audioFullPath = path.resolve(repo.getDatasetDir(data.datasetName), item.audioPath);
                const draft = yield* drafter.draftFromAudio(audioFullPath, item.id);
                yield* repo.updateItem(data.datasetName, item.id, {
                  draftTranscript: draft.transcript,
                  expectedTerms: draft.expectedTerms,
                  keyPoints: draft.keyPoints
                });
                return draft;
              })
            )
              .then((draft) => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(draft));
              })
              .catch((err) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(err) }));
              });
          } catch (err) {
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
            console.log(`\n🎧 Ground Truth Review Web UI is running at: http://localhost:${port}?dataset=${datasetName}`);
            console.log(`   Press Ctrl+C to stop the review server.\n`);
            resolve();
          });
          server.on("error", reject);
        }),
      catch: (err) => new Error(`Failed to start review server: ${String(err)}`)
    });

    // Keep server running until interrupted
    yield* Effect.never;
  });
