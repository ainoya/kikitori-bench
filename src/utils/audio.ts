import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { parseFile } from "music-metadata";

const execFileAsync = promisify(execFile);

export const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".flac",
  ".aac",
  ".webm",
]);

export const isAudioFile = (filename: string): boolean => {
  const ext = path.extname(filename).toLowerCase();
  return SUPPORTED_AUDIO_EXTENSIONS.has(ext);
};

export const getAudioMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp3":
      return "audio/mp3";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".ogg":
      return "audio/ogg";
    case ".flac":
      return "audio/flac";
    case ".aac":
      return "audio/aac";
    case ".webm":
      return "audio/webm";
    default:
      return "application/octet-stream";
  }
};

export const readAudioBase64 = (filePath: string): string => {
  const buffer = fs.readFileSync(filePath);
  return buffer.toString("base64");
};

export const getAudioDurationMs = async (filePath: string): Promise<number> => {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const metadata = await parseFile(filePath);
    return metadata.format.duration ? Math.round(metadata.format.duration * 1000) : 0;
  } catch {
    return 0;
  }
};

/**
 * Convert any supported audio file into mono 16 kHz 16-bit PCM WAV,
 * as required by ASR endpoints that only accept raw WAV input.
 * Returns the path of a temporary file the caller is responsible for deleting.
 */
export const convertToWav16kMono = async (filePath: string): Promise<string> => {
  const outPath = path.join(os.tmpdir(), `kikitori-${process.pid}-${randomUUID()}.wav`);
  await execFileAsync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    filePath,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    outPath,
  ]);
  return outPath;
};
