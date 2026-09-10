import { Effect } from "effect";
import { ValidationError } from "../errors.js";
import { DatasetRepo } from "../services/DatasetRepo.js";
import { RunRepo } from "../services/RunRepo.js";
import type { AppConfig } from "../schemas/config.js";
import type { DatasetItem } from "../schemas/dataset.js";
import type {
  CompareHypothesis,
  CompareModel,
  CompareSample,
  ComparisonView,
} from "../schemas/compare.js";

// NUL cannot occur in a sample id or a model id, so the composite key is
// unambiguous; written as an escape so the source stays plain ASCII.
const keyOf = (sampleId: string, modelId: string) => `${sampleId}\u0000${modelId}`;

/**
 * Merge one or more stored runs with their dataset manifest into the shape the
 * side-by-side view renders: one row per sample, ground truth first, then one
 * column per model. Judge scores are attached when a run has been evaluated.
 *
 * Merging matters because the models being compared are seldom all in one run:
 * a provider added later is benchmarked separately over the same samples.
 * Column order follows the order the runs were given; where two runs cover the
 * same sample and model, the newer run wins.
 */
export const buildComparisonView = (runIds: readonly string[], config: AppConfig) =>
  Effect.gen(function* () {
    const runRepo = yield* RunRepo;
    const datasetRepo = yield* DatasetRepo;

    if (runIds.length === 0) {
      return yield* Effect.fail(new ValidationError({ message: "No run selected" }));
    }

    const batches = yield* Effect.all(runIds.map((runId) => runRepo.loadAsrRun(runId)));
    const reports = yield* Effect.all(runIds.map((runId) => runRepo.loadReport(runId)));

    // Ground truth differs per dataset, so a cross-dataset merge would compare
    // hypotheses against the wrong reference.
    const datasetNames = [...new Set(batches.map((batch) => batch.datasetName))];
    if (datasetNames.length > 1) {
      return yield* Effect.fail(
        new ValidationError({
          message: `Cannot merge runs from different datasets: ${datasetNames.join(", ")}`,
        }),
      );
    }
    const datasetName = datasetNames[0] ?? "";

    // A run outlives the dataset it came from; comparing hypotheses is still
    // useful without ground truth, so a missing manifest is not fatal here.
    const manifest = yield* datasetRepo
      .loadManifest(datasetName)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    const itemsById = new Map<string, DatasetItem>(
      (manifest?.items ?? []).map((item) => [item.id, item]),
    );

    const displayNameOf = (modelId: string): string => {
      for (const batch of batches) {
        const condition = batch.conditions?.find((c) => c.modelId === modelId);
        if (condition) return condition.displayName;
      }
      return config.models[modelId]?.displayName ?? modelId;
    };

    // Columns follow the given run order; results come from the newest run.
    const orderedModelIds: string[] = [];
    for (const batch of batches) {
      for (const modelId of batch.models) {
        if (!orderedModelIds.includes(modelId)) orderedModelIds.push(modelId);
      }
    }
    const models: CompareModel[] = orderedModelIds.map((modelId) => ({
      modelId,
      displayName: displayNameOf(modelId),
    }));

    const byTimestamp = batches
      .map((batch, index) => ({ batch, report: reports[index] }))
      .sort((a, b) => a.batch.timestamp.localeCompare(b.batch.timestamp));

    const scoreByKey = new Map<string, number>();
    const hypothesisByKey = new Map<string, CompareHypothesis>();
    const sampleIds = new Set<string>();
    for (const { batch, report } of byTimestamp) {
      for (const evaluation of report?.evaluations ?? []) {
        scoreByKey.set(keyOf(evaluation.sampleId, evaluation.modelId), evaluation.overallScore);
      }
      for (const result of batch.results) {
        sampleIds.add(result.sampleId);
        hypothesisByKey.set(keyOf(result.sampleId, result.modelId), {
          modelId: result.modelId,
          hypothesis: result.hypothesis,
          latencyMs: result.latencyMs,
          audioDurationMs: result.audioDurationMs,
          rtf: result.rtf,
          error: result.error,
        });
      }
    }

    // Manifest order first (that is the order a reviewer verified them in),
    // then any sample the runs have but the manifest no longer does.
    const manifestOrder = (manifest?.items ?? [])
      .map((item) => item.id)
      .filter((id) => sampleIds.has(id));
    const extraIds = [...sampleIds].filter((id) => !itemsById.has(id));
    const orderedIds = [...manifestOrder, ...extraIds];

    const samples: CompareSample[] = orderedIds.map((sampleId) => {
      const item = itemsById.get(sampleId);
      return {
        sampleId,
        groundTruth: item?.groundTruth ?? "",
        expectedTerms: item?.expectedTerms ?? [],
        audioPath: item?.audioPath,
        durationSec: item?.durationSec,
        verified: item?.verified ?? false,
        // Keep the model column order stable even when a model produced nothing
        // for this sample, which is what a partially covered merge looks like.
        hypotheses: models.map((model) => {
          const key = keyOf(sampleId, model.modelId);
          const stored = hypothesisByKey.get(key);
          return {
            ...(stored ?? { modelId: model.modelId, hypothesis: "" }),
            overallScore: scoreByKey.get(key),
          };
        }),
      };
    });

    const view: ComparisonView = {
      runIds: batches.map((batch) => batch.runId),
      datasetName,
      timestamp:
        batches
          .map((batch) => batch.timestamp)
          .sort()
          .at(-1) ?? "",
      evaluated: reports.some((report) => report !== undefined),
      models,
      samples,
    };
    return view;
  });
