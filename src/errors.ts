import { Data } from "effect";

export class DatasetNotFoundError extends Data.TaggedError("DatasetNotFoundError")<{
  readonly datasetName: string;
  readonly path: string;
}> {}

export class DatasetItemNotFoundError extends Data.TaggedError("DatasetItemNotFoundError")<{
  readonly datasetName: string;
  readonly itemId: string;
}> {}

export class AudioFileNotFoundError extends Data.TaggedError("AudioFileNotFoundError")<{
  readonly path: string;
}> {}

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AsrExecutionError extends Data.TaggedError("AsrExecutionError")<{
  readonly modelId: string;
  readonly sampleId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class JudgeConnectionError extends Data.TaggedError("JudgeConnectionError")<{
  readonly endpoint: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class JudgeEvaluationError extends Data.TaggedError("JudgeEvaluationError")<{
  readonly sampleId: string;
  readonly modelId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DraftingError extends Data.TaggedError("DraftingError")<{
  readonly sampleId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ReviewServerError extends Data.TaggedError("ReviewServerError")<{
  readonly port: number;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly details?: unknown;
}> {}

export class RunNotFoundError extends Data.TaggedError("RunNotFoundError")<{
  readonly runId: string;
  readonly path: string;
}> {}
