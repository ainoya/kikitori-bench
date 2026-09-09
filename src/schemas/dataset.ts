import { Schema } from "effect";

export const DatasetItemSchema = Schema.Struct({
  id: Schema.String,
  audioPath: Schema.String, // relative path from dataset dir, e.g. "audio/sample1.wav"
  groundTruth: Schema.String, // verified ground truth text
  draftTranscript: Schema.optional(Schema.String), // raw Gemini draft before verification
  expectedTerms: Schema.Array(Schema.String), // list of domain-specific terms that must be recognized
  keyPoints: Schema.Array(Schema.String), // list of critical propositions/facts that must be conveyed
  verified: Schema.Boolean, // whether human has approved this item
  durationSec: Schema.optional(Schema.Number),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String)
});

export type DatasetItem = typeof DatasetItemSchema.Type;

export const DatasetManifestSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  items: Schema.Array(DatasetItemSchema)
});

export type DatasetManifest = typeof DatasetManifestSchema.Type;
