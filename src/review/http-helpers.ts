import type * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAudioMimeType } from "../utils/audio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const sendJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

export const sendText = (res: http.ServerResponse, status: number, body: string): void => {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
};

/**
 * The static pages ship next to the compiled server in `dist/`, but a `tsx`
 * run resolves this module inside `src/`; try both before giving up.
 */
export const serveStaticPage = (res: http.ServerResponse, fileName: string): void => {
  const candidatePaths = [
    path.resolve(__dirname, "static", fileName),
    path.resolve(__dirname, "..", "..", "src", "review", "static", fileName),
  ];
  const htmlPath = candidatePaths.find((p) => fs.existsSync(p));
  if (!htmlPath) {
    sendText(res, 404, `${fileName} not found`);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  fs.createReadStream(htmlPath).pipe(res);
};

/**
 * Stream an audio file, honouring HTTP Range requests so the player can seek
 * without downloading the whole recording.
 */
export const serveAudioFile = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  audioFullPath: string,
): void => {
  if (!fs.existsSync(audioFullPath)) {
    sendText(res, 404, "Audio file not found");
    return;
  }

  const totalSize = fs.statSync(audioFullPath).size;
  const mimeType = getAudioMimeType(audioFullPath);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0] ?? "0", 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": mimeType,
    });
    fs.createReadStream(audioFullPath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "Content-Length": totalSize,
    "Accept-Ranges": "bytes",
    "Content-Type": mimeType,
  });
  fs.createReadStream(audioFullPath).pipe(res);
};

/**
 * Reject a dataset-relative path that escapes the dataset directory before it
 * reaches the filesystem.
 */
export const resolveWithinDir = (baseDir: string, relPath: string): string | undefined => {
  const resolved = path.resolve(baseDir, relPath);
  const normalisedBase = path.resolve(baseDir) + path.sep;
  return resolved.startsWith(normalisedBase) ? resolved : undefined;
};
