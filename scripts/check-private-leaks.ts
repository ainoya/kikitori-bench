// Pre-publish check: does anything staged for commit contain private material?
//
// The dataset, runs and reports are git-ignored, but content leaks by other
// routes - an example copied into a comment, a personal path in a default
// argument. This reads the local private material and looks for it in the
// files that would actually be published.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const staged = execFileSync(
  "git",
  ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const read = (f: string): string => fs.readFileSync(f, "utf8");
const readStaged = (f: string): string =>
  execFileSync("git", ["show", `:${f}`], { encoding: "utf8" });
const files = staged.map((f) => ({ f, text: readStaged(f) }));

interface Finding {
  severity: "FAIL" | "check";
  what: string;
  where: string;
}

const findings: Finding[] = [];
const report = (severity: Finding["severity"], what: string, where: string): void => {
  findings.push({ severity, what, where });
};

// ---------------------------------------------------------------- corpus
// Only what the speaker actually said, plus the annotations derived from it.
// Reports and run artefacts are excluded on purpose: they are full of the
// judge's English prose, and matching against that flags every ordinary word.
const corpusFiles: string[] = [];
if (fs.existsSync("datasets")) {
  for (const entry of fs.readdirSync("datasets", { withFileTypes: true })) {
    const manifest = path.join("datasets", entry.name, "dataset.yaml");
    if (entry.isDirectory() && entry.name !== "demo" && fs.existsSync(manifest)) {
      corpusFiles.push(manifest);
    }
  }
}
const corpus = corpusFiles.map(read).join("\n");

// Structural keys of the manifest itself, not spoken content.
const MANIFEST_KEYS = new Set(
  (
    "name description createdAt updatedAt items audioPath groundTruth draftTranscript " +
    "expectedTerms keyPoints verified notes true false null audio Imported from " +
    "voice journal Obsidian notes recordings Private Japanese dictation captured " +
    "app never published"
  )
    .split(/\s+/)
    .map((w) => w.toLowerCase()),
);

// Latin-script words the speaker actually used - product names, company names,
// acronyms. This set is small, so every hit is worth a human look.
const spokenLatin = new Set<string>(
  (corpus.match(/[A-Za-z][A-Za-z0-9_.-]{2,}/g) ?? [])
    .map((w) => w.replace(/[.]+$/, ""))
    .filter((w) => !MANIFEST_KEYS.has(w.toLowerCase())),
);
for (const { f, text } of files) {
  for (const word of spokenLatin) {
    const re = new RegExp(
      `(^|[^A-Za-z0-9_-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`,
    );
    if (re.test(text)) report("check", `word spoken in the recordings: "${word}"`, f);
  }
}

// Japanese n-grams shared with the private transcripts
const jaGrams = new Set<string>();
for (const m of corpus.match(/[ぁ-んァ-ヶ一-龥ー]{6,}/g) ?? []) {
  for (let i = 0; i <= m.length - 6; i++) jaGrams.add(m.slice(i, i + 6));
}
for (const { f, text } of files) {
  for (const gram of jaGrams) {
    if (text.includes(gram)) report("check", `Japanese 6-gram "${gram}"`, f);
  }
}

// Hard failures: secrets and machine-specific paths
// Split the private path markers so this detector does not match its own
// source code while still scanning the rest of this file normally.
const privateVaultPattern = new RegExp(
  [
    ["Mobile", " Documents"].join(""),
    ["iCloud", "~"].join(""),
    ["Library", "/Containers"].join(""),
  ].join("|"),
  "g",
);
const PATTERNS: Array<[RegExp, string]> = [
  // Describing what the private material is about leaks it just as surely as
  // quoting it. The phrases are assembled from fragments so that this rule does
  // not match its own source.
  [
    new RegExp(
      [
        ["family", "names"].join(" "),
        ["health", "and", "financial"].join(" "),
        ["personal", "and", "family"].join(" "),
        ["workplace", "information"].join(" "),
      ].join("|"),
      "gi",
    ),
    "describes the private corpus's subject matter",
  ],
  [/\/Users\/[a-z0-9_.-]+/gi, "absolute home path"],
  [privateVaultPattern, "personal vault path"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "email address"],
  [/\b(?:gsk_|sk-|xai-|AQ\.Ab8|AIza)[A-Za-z0-9_-]{20,}/g, "API key"],
  [/\b(?!127\.0\.0\.1|0\.0\.0\.0)(?:\d{1,3}\.){3}\d{1,3}\b/g, "IP address"],
];
for (const { f, text } of files) {
  for (const [re, label] of PATTERNS) {
    for (const hit of text.match(re) ?? []) report("FAIL", `${label}: ${hit}`, f);
  }
}

// Anything staged that should never be
for (const f of staged) {
  if (/^(runs|reports)\//.test(f)) report("FAIL", "run/report artefact staged", f);
  if (/^datasets\//.test(f) && !f.startsWith("datasets/demo"))
    report("FAIL", "non-demo dataset staged", f);
  if (/\.(m4a|mp3|wav|ogg|flac|aac)$/.test(f)) report("FAIL", "audio file staged", f);
}

const fails = findings.filter((x) => x.severity === "FAIL");
const checks = findings.filter((x) => x.severity === "check");
console.log(
  `staged files: ${staged.length}, private corpus: ${corpus.length.toLocaleString()} chars`,
);
console.log(`\nFAIL: ${fails.length}`);
for (const x of fails) console.log(`  ✗ ${x.where}: ${x.what}`);
// Group by the matched item: one line per distinct word is reviewable, one
// line per (word, file) pair is not.
const grouped = new Map<string, string[]>();
for (const x of checks) {
  const entry = grouped.get(x.what) ?? [];
  entry.push(x.where);
  grouped.set(x.what, entry);
}
console.log(`\nreview manually: ${grouped.size} distinct item(s)`);
for (const [what, where] of [...grouped].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
  console.log(
    `  ? ${what}  -> ${where.length > 3 ? `${where.slice(0, 3).join(", ")} +${where.length - 3}` : where.join(", ")}`,
  );
}
process.exit(fails.length > 0 ? 1 : 0);
