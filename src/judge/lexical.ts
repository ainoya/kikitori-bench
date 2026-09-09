import { createRequire } from "node:module";
import * as path from "node:path";
import kuromoji from "kuromoji";

/**
 * Deterministic lexical scoring for proper nouns and numbers.
 *
 * These are the tokens where a transcript is either right or wrong regardless of
 * how natural it reads - a person's name rendered as a different name is a hard
 * error even when the sentence is fluent. Ordinary vocabulary is deliberately
 * not scored here: on this corpus every model gets the common words right, so
 * averaging them in only dilutes the signal, and a general-word error that
 * changes the meaning is already caught by the proposition axes.
 *
 * The same extractor runs over the reference and the hypothesis, so its
 * segmentation mistakes are common-mode and largely cancel out.
 */

export interface LexicalScore {
  recall: number;
  precision: number;
  f1: number;
  referenceTokens: readonly string[];
  hypothesisTokens: readonly string[];
  missed: readonly string[];
  fabricated: readonly string[];
}

type Tokenizer = {
  tokenize(text: string): Array<{
    surface_form: string;
    pos: string;
    pos_detail_1: string;
    basic_form: string;
    word_type: string;
  }>;
};

let tokenizerPromise: Promise<Tokenizer> | undefined;

const dictionaryPath = (): string => {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve("kuromoji/package.json")), "dict");
};

/** Built once per process; the dictionary load is the expensive part. */
export const getTokenizer = (): Promise<Tokenizer> => {
  tokenizerPromise ??= new Promise<Tokenizer>((resolve, reject) => {
    kuromoji
      .builder({ dicPath: dictionaryPath() })
      .build((err: Error | null, tokenizer: Tokenizer) =>
        err ? reject(err) : resolve(tokenizer)
      );
  });
  return tokenizerPromise;
};

export const extractProperNouns = (tokenizer: Tokenizer, text: string): string[] => {
  const out: string[] = [];
  let run: string[] = [];
  for (const token of tokenizer.tokenize(text ?? "")) {
    const isProper =
      token.pos === "名詞" && (token.pos_detail_1 === "固有名詞" || token.pos_detail_1 === "数");
    // Names and coined product words are usually out of dictionary; treating an
    // unknown noun as a proper noun is what lets a coined product name be
    // scored at all.
    const isUnknownNoun = token.word_type === "UNKNOWN" && token.pos === "名詞";
    if (isProper || isUnknownNoun) {
      run.push(token.surface_form);
    } else if (run.length > 0) {
      out.push(run.join(""));
      run = [];
    }
  }
  if (run.length > 0) out.push(run.join(""));
  // Unknown-noun runs also catch fragments of ordinary inflection, which are
  // all-hiragana, so require at least one character that a name,
  // number or loanword would actually contain. This drops the rare all-hiragana
  // given name too, but it is applied to reference and hypothesis alike.
  return out.filter((t) => t.length > 1 && /[一-龥ァ-ヶーA-Za-z0-9]/.test(t));
};

/** Multiset overlap: a name said twice and transcribed once is half credit. */
const overlap = (a: readonly string[], b: readonly string[]): { hit: number; missing: string[] } => {
  const bag = new Map<string, number>();
  for (const x of b) bag.set(x, (bag.get(x) ?? 0) + 1);
  let hit = 0;
  const missing: string[] = [];
  for (const x of a) {
    const count = bag.get(x) ?? 0;
    if (count > 0) {
      bag.set(x, count - 1);
      hit += 1;
    } else {
      missing.push(x);
    }
  }
  return { hit, missing };
};

const round1 = (n: number) => Math.round(n * 1000) / 10;

export const scoreProperNouns = (
  tokenizer: Tokenizer,
  groundTruth: string,
  hypothesis: string
): LexicalScore => {
  const reference = extractProperNouns(tokenizer, groundTruth);
  const hypothesisTokens = extractProperNouns(tokenizer, hypothesis);

  const forward = overlap(reference, hypothesisTokens);
  const backward = overlap(hypothesisTokens, reference);

  const recall = reference.length > 0 ? forward.hit / reference.length : 1;
  const precision = hypothesisTokens.length > 0 ? backward.hit / hypothesisTokens.length : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    recall: round1(recall),
    precision: round1(precision),
    f1: round1(f1),
    referenceTokens: reference,
    hypothesisTokens,
    missed: forward.missing,
    fabricated: backward.missing
  };
};
