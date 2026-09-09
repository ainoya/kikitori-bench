import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import { Effect } from "effect";
import type { DatasetItem, DatasetManifest } from "../schemas/dataset.js";
import { ValidationError } from "../errors.js";

export interface ImportJournalOptions {
  sourceDir: string;
  datasetName: string;
  copyAudio?: boolean;
}

export interface ImportResult {
  totalScanned: number;
  matchedNotes: number;
  importedItems: number;
  skippedMissingAudio: number;
  datasetDir: string;
  yamlPath: string;
}

const STOPWORDS = new Set([
  "これ", "それ", "あれ", "どれ", "ここ", "そこ", "あそこ", "どこ",
  "私", "僕", "俺", "自分", "あなた", "やつ", "こと", "もの", "ため",
  "感じ", "ところ", "今", "今日", "昨日", "明日", "今回", "前回",
  "そう", "どう", "こう", "なんか", "ちょっと", "まあ", "やっぱり",
  "たくさん", "いろいろ", "いっぱい", "かなり", "だいぶ", "全然", "ひとつ",
  "ふたつ", "みっつ", "何", "誰", "どこか", "いつも", "みんな"
]);

/**
 * Optional vocabulary hints for term extraction, read from
 * `datasets/<name>/domain-keywords.txt` (one term per line) when present.
 *
 * Kept out of the source on purpose: a speaker's recurring vocabulary is itself
 * private, so it lives with the dataset and is git-ignored along with it.
 */
const loadDomainKeywords = (datasetDir: string): string[] => {
  const file = path.resolve(datasetDir, "domain-keywords.txt");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
};


/**
 * Extracts distinct expected terms appearing in the ground truth text.
 */
export const extractExpectedTerms = (
  gt: string,
  title?: string,
  _situation?: string,
  domainKeywords: readonly string[] = []
): string[] => {
  const terms = new Set<string>();

  // 1. Katakana words (length >= 2)
  const katakanaMatches = gt.match(/[ァ-ヴー]{2,}/g) ?? [];
  for (const w of katakanaMatches) {
    if (!STOPWORDS.has(w) && w.length >= 2) {
      terms.add(w);
    }
  }

  // 2. English / Alphanumeric terms (length >= 2, not purely digits)
  const enMatches = gt.match(/[A-Za-z][A-Za-z0-9+.-]{1,}/g) ?? [];
  for (const w of enMatches) {
    if (!/^\d+$/.test(w) && w.length >= 2) {
      terms.add(w);
    }
  }

  // 3. Optional per-dataset vocabulary hints, if the dataset provides them
  for (const kw of domainKeywords) {
    if (gt.includes(kw)) {
      terms.add(kw);
    }
  }

  // 4. Salient words in title that appear in GT
  if (title) {
    const titleWords = title.split(/[、\s・とにおけるのを]+/).filter((w) => w.length >= 2);
    for (const tw of titleWords) {
      if (gt.includes(tw) && !STOPWORDS.has(tw) && !/^[0-9]+$/.test(tw)) {
        terms.add(tw);
      }
    }
  }

  // Deduplicate and filter out substrings if a longer compound exists (e.g. "Flash" vs "Gemini 3.5Flash")
  const termArr = Array.from(terms);
  const filtered = termArr.filter(
    (t) => !termArr.some((other) => other !== t && other.includes(t) && other.length > t.length + 3)
  );

  return filtered.slice(0, 6);
};

/**
 * Formulates core key propositions conveyed in the speech.
 */
export const extractKeyPoints = (
  gt: string,
  title?: string,
  situation?: string
): string[] => {
  const points: string[] = [];

  // Short utterance
  if (gt.length < 35) {
    if (title) {
      points.push(`${title.replace(/についての.*$/, "")}について発話している`);
    } else {
      points.push(`「${gt}」と発話している`);
    }
    return points;
  }

  // Extract from title clauses
  if (title) {
    const clauses = title
      .split(/[、。]|と(?=[^a-zA-Z0-9])/)
      .map((c) => c.trim())
      .filter((c) => c.length >= 4);
    for (const c of clauses) {
      points.push(`${c}ことについて述べている`);
    }
  }

  // Extract from situation context (factual parts, ignoring audio acoustic comments)
  if (situation && points.length < 3) {
    const sitSentences = situation
      .split(/[。！]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 8);
    for (const s of sitSentences) {
      if (points.length >= 3) break;
      if (
        s.includes("録音している様子") ||
        s.includes("環境音") ||
        s.includes("足音が混ざって") ||
        s.includes("BGMが流れて") ||
        s.includes("独り言の記録")
      ) {
        continue;
      }
      points.push(s);
    }
  }

  // Fallback to ground truth sentences
  if (points.length === 0) {
    const sentences = gt
      .split(/[。\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 8);
    for (const s of sentences.slice(0, 2)) {
      points.push(s);
    }
  }

  return points.slice(0, 4);
};

/**
 * Extracts the transcript body from a voice-journal Obsidian note.
 * Strips frontmatter, summary sections (## 状況, ## 要約, ## サマリ), and audio links.
 */
export const extractCleanTranscript = (rawContent: string): string => {
  // 1. Remove YAML frontmatter
  let body = rawContent.replace(/^---[\s\S]*?---\s*/, "");

  // 2. Locate "## 文字起こし" if present
  const transcriptHeaderRegex = /##\s*文字起こし\s*\n/i;
  const match = transcriptHeaderRegex.exec(body);
  if (match) {
    body = body.slice(match.index + match[0].length);
  }

  // 3. Cut off at subsequent markdown section headers (e.g., ## 状況, ## 要約, ## サマリ, ## メモ, etc.)
  const nextSectionMatch = body.search(/\n##\s+/);
  if (nextSectionMatch !== -1) {
    body = body.slice(0, nextSectionMatch);
  }

  // 4. Remove recording audio markdown links like [recording-....m4a](....m4a)
  body = body.replace(/\[.*?\]\(.*?\.(?:m4a|wav|mp3|ogg|aac|flac)\)/gi, "");

  // 5. Remove any wiki-style links/embeds like ![[...]] or [[...]]
  body = body.replace(/!?\[\[.*?\]\]/g, "");

  // 6. Normalize multiple blank lines and trim
  body = body.replace(/\n{3,}/g, "\n\n").trim();

  return body;
};

export const importFromVoiceJournal = (options: ImportJournalOptions): Effect.Effect<ImportResult, ValidationError> =>
  Effect.gen(function* () {
    const { sourceDir, datasetName, copyAudio = true } = options;

    if (!fs.existsSync(sourceDir)) {
      return yield* Effect.fail(
        new ValidationError({
          message: `Source directory does not exist at: ${sourceDir}`
        })
      );
    }

    const datasetDir = path.resolve(process.cwd(), "datasets", datasetName);
    const domainKeywords = loadDomainKeywords(datasetDir);
    const audioDir = path.resolve(datasetDir, "audio");
    const yamlPath = path.resolve(datasetDir, "dataset.yaml");

    if (!fs.existsSync(datasetDir)) {
      fs.mkdirSync(datasetDir, { recursive: true });
    }
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    let totalScanned = 0;
    let matchedNotes = 0;
    let skippedMissingAudio = 0;
    const items: DatasetItem[] = [];

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.endsWith(".assets") && !entry.name.startsWith(".")) {
            walk(full);
          }
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          totalScanned++;
          const content = fs.readFileSync(full, "utf-8");

          // Check for gemini 3.x-flash tag/model
          const isGemini3Flash =
            /transcription_model:\s*["\x27]?gemini-3[.\d]*-flash/i.test(content) ||
            /gemini[-_ ]?3[.\d]*[-_ ]?flash/i.test(content);

          if (!isGemini3Flash) continue;
          matchedNotes++;

          // Extract model name from frontmatter
          const modelMatch = content.match(/transcription_model:\s*["\x27]?([^"\x27\n\r]+)["\x27]?/i);
          const modelName = modelMatch && modelMatch[1] ? modelMatch[1].trim() : "gemini-3.x-flash";

          // Extract audio link
          const audioMatch = content.match(/\[.*?\]\((.*?\.m4a|.*?\.wav|.*?\.mp3)\)/i);
          if (!audioMatch || !audioMatch[1]) {
            skippedMissingAudio++;
            continue;
          }

          const relAudio = audioMatch[1];
          const audioSrcFullPath = path.resolve(path.dirname(full), relAudio);

          if (!fs.existsSync(audioSrcFullPath)) {
            skippedMissingAudio++;
            continue;
          }

          const cleanText = extractCleanTranscript(content);
          if (!cleanText) continue;

          // Extract title & situation metadata
          const body = content.replace(/^---[\s\S]*?---\s*/, "");
          const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
          const title = lines[0] && !lines[0].startsWith("#") ? lines[0] : "";
          const sitMatch = body.match(/##\s*(?:状況|要約|サマリ)\s*\n([\s\S]*?)(?=\n## |\n\[|$)/i);
          const situation = sitMatch && sitMatch[1] ? sitMatch[1].trim() : "";

          const expectedTerms = extractExpectedTerms(cleanText, title, situation, domainKeywords);
          const keyPoints = extractKeyPoints(cleanText, title, situation);

          const baseId = path.basename(full, ".md");
          const ext = path.extname(audioSrcFullPath);
          const destAudioFilename = `${baseId}${ext}`;
          const destAudioFullPath = path.resolve(audioDir, destAudioFilename);

          if (copyAudio && !fs.existsSync(destAudioFullPath)) {
            fs.copyFileSync(audioSrcFullPath, destAudioFullPath);
          }

          const now = new Date().toISOString();
          items.push({
            id: baseId,
            audioPath: path.posix.join("audio", destAudioFilename),
            groundTruth: cleanText,
            draftTranscript: cleanText,
            expectedTerms,
            keyPoints,
            verified: true,
            createdAt: now,
            updatedAt: now,
            notes: `Imported from voice-journal notes (${modelName})`
          });
        }
      }
    };

    walk(sourceDir);

    // Sort items by ID (chronological)
    items.sort((a, b) => a.id.localeCompare(b.id));

    const now = new Date().toISOString();
    const manifest: DatasetManifest = {
      name: datasetName,
      description: `Voice-journal dataset built from Obsidian notes (${items.length} samples)`,
      createdAt: now,
      updatedAt: now,
      items
    };

    try {
      fs.writeFileSync(yamlPath, yaml.stringify(manifest), "utf-8");
    } catch (err) {
      return yield* Effect.fail(
        new ValidationError({
          message: `Failed to write dataset.yaml at ${yamlPath}: ${String(err)}`,
          details: err
        })
      );
    }

    return {
      totalScanned,
      matchedNotes,
      importedItems: items.length,
      skippedMissingAudio,
      datasetDir,
      yamlPath
    };
  });
