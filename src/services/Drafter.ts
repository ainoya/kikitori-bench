import * as fs from "node:fs";
import { Context, Effect, Layer, Schema } from "effect";
import { DraftingError } from "../errors.js";
import { getAudioMimeType, readAudioBase64 } from "../utils/audio.js";

export const DraftOutputSchema = Schema.Struct({
  transcript: Schema.String,
  expectedTerms: Schema.Array(Schema.String),
  keyPoints: Schema.Array(Schema.String)
});

export type DraftOutput = typeof DraftOutputSchema.Type;

export const KeyPointsOutputSchema = Schema.Struct({
  keyPoints: Schema.Array(Schema.String)
});

export interface DrafterShape {
  draftFromAudio(
    audioFullPath: string,
    sampleId: string
  ): Effect.Effect<DraftOutput, DraftingError>;
  /**
   * Re-derive key points from a verified transcript at a granularity fine
   * enough to keep the score resolving on long clips. The target count is
   * computed from the audio duration by the caller - the transcript text alone
   * gives the model no way to know how long the recording was.
   */
  refineKeyPoints(
    groundTruth: string,
    targetCount: number,
    sampleId: string
  ): Effect.Effect<readonly string[], DraftingError>;
}

/** ~2.5 independently checkable propositions per 30 seconds of speech. */
export const targetKeyPointCount = (audioDurationMs: number, groundTruth: string): number => {
  const fromDuration = (audioDurationMs / 30_000) * 2.5;
  // A short clip that is dense with content still deserves more than two points.
  const fromText = groundTruth.replace(/\s/g, "").length / 45;
  return Math.max(2, Math.min(40, Math.round(Math.max(fromDuration, fromText))));
};

export class Drafter extends Context.Tag("Drafter")<Drafter, DrafterShape>() {}

export const DrafterLive = Layer.succeed(
  Drafter,
  Drafter.of({
    refineKeyPoints(groundTruth: string, targetCount: number, sampleId: string) {
      return Effect.gen(this, function* () {
        const apiKey = process.env["GEMINI_API_KEY"];
        if (!apiKey) {
          return yield* Effect.fail(
            new DraftingError({ sampleId, message: "GEMINI_API_KEY is not set" })
          );
        }
        const model = process.env["GEMINI_DRAFT_MODEL"] ?? "gemini-3.8-flash";

        const prompt = `You are preparing the evaluation checklist for a Japanese speech-recognition benchmark.

Split the transcript below into atomic propositions ("key points") that a correct
transcript must convey.

Rules:
- Exactly one assertion per proposition: one subject and one predicate. Split any
  sentence joined by 「〜して」「〜が」「〜けど」 into separate propositions.
- Each proposition must be verifiable on its own, without reading the others.
- Keep every number, date, quantity, proper noun, and negation in the proposition
  that depends on it - these are what the benchmark checks.
- Write them in Japanese, in the order they are spoken.
- Produce about ${targetCount} propositions (±2). Do not merge distinct claims to
  reach a smaller number, and do not invent content to reach a larger one.

### Transcript
"""
${groundTruth}
"""

Output strictly this JSON and nothing else:
{ "keyPoints": ["...", "..."] }`;

        const payload = {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json" }
        };

        const response = yield* Effect.tryPromise({
          try: async () => {
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
                body: JSON.stringify(payload)
              }
            );
            if (!res.ok) {
              throw new Error(`Gemini API returned status ${res.status}: ${await res.text()}`);
            }
            return await res.json();
          },
          catch: (err) =>
            new DraftingError({
              sampleId,
              message: `Failed to call Gemini API for key point refinement: ${String(err)}`,
              cause: err
            })
        });

        try {
          const resObj = response as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const rawText = resObj.candidates?.[0]?.content?.parts
            ?.map((part) => part.text ?? "")
            .join("");
          if (!rawText) throw new Error("No text content returned in Gemini response");
          const decoded = Schema.decodeUnknownEither(KeyPointsOutputSchema)(JSON.parse(rawText));
          if (decoded._tag === "Left") {
            throw new Error(`Failed to decode key points: ${JSON.stringify(decoded.left)}`);
          }
          return decoded.right.keyPoints.filter((k) => k.trim().length > 0);
        } catch (parseErr) {
          return yield* Effect.fail(
            new DraftingError({
              sampleId,
              message: `Failed to parse Gemini key point JSON: ${String(parseErr)}`,
              cause: parseErr
            })
          );
        }
      });
    },

    draftFromAudio(audioFullPath: string, sampleId: string) {
      return Effect.gen(this, function* () {
        if (!fs.existsSync(audioFullPath)) {
          return yield* Effect.fail(
            new DraftingError({
              sampleId,
              message: `Audio file does not exist at ${audioFullPath}`
            })
          );
        }

        const apiKey = process.env["GEMINI_API_KEY"];
        if (!apiKey) {
          // If no GEMINI_API_KEY is configured, provide a placeholder draft for human editing
          return {
            transcript: `[Gemini API key not configured - please edit transcript for ${sampleId}]`,
            expectedTerms: [],
            keyPoints: []
          };
        }

        const mimeType = getAudioMimeType(audioFullPath);
        const base64Data = readAudioBase64(audioFullPath);
        const model = process.env["GEMINI_DRAFT_MODEL"] ?? "gemini-2.5-flash";

        const systemPrompt = `You are an expert speech recognition annotator.
Transcribe the provided audio into Japanese text as accurately as possible.
Also extract:
1. "expectedTerms": An array of important domain-specific keywords, technical terms, or proper nouns appearing in the audio.
2. "keyPoints": An array of core factual propositions or key statements conveyed in the speech that must not be missed.

Output strictly in JSON format matching this schema:
{
  "transcript": "...",
  "expectedTerms": ["term1", "term2"],
  "keyPoints": ["point1", "point2"]
}`;

        const payload = {
          contents: [
            {
              role: "user",
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                  }
                },
                {
                  text: systemPrompt
                }
              ]
            }
          ],
          generationConfig: {
            response_mime_type: "application/json"
          }
        };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = yield* Effect.tryPromise({
          try: async () => {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            if (!res.ok) {
              const errText = await res.text();
              throw new Error(`Gemini API returned status ${res.status}: ${errText}`);
            }
            return await res.json();
          },
          catch: (err) =>
            new DraftingError({
              sampleId,
              message: `Failed to call Gemini API for drafting: ${String(err)}`,
              cause: err
            })
        });

        try {
          const resObj = response as {
            candidates?: Array<{
              content?: {
                parts?: Array<{ text?: string }>;
              };
            }>;
          };
          const rawText = resObj.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!rawText) {
            throw new Error("No text content returned in Gemini response");
          }
          const parsed: unknown = JSON.parse(rawText);
          const decoded = Schema.decodeUnknownEither(DraftOutputSchema)(parsed);
          if (decoded._tag === "Left") {
            throw new Error(`Failed to decode Gemini output schema: ${JSON.stringify(decoded.left)}`);
          }
          return decoded.right;
        } catch (parseErr) {
          return yield* Effect.fail(
            new DraftingError({
              sampleId,
              message: `Failed to parse Gemini draft JSON output: ${String(parseErr)}`,
              cause: parseErr
            })
          );
        }
      });
    }
  })
);
