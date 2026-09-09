import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import { Context, Effect, Layer, Schema } from "effect";
import {
  DatasetManifestSchema,
  type DatasetItem,
  type DatasetManifest,
} from "../schemas/dataset.js";
import { DatasetNotFoundError, DatasetItemNotFoundError, ValidationError } from "../errors.js";
import { isAudioFile } from "../utils/audio.js";

export interface DatasetRepoShape {
  getDatasetDir(datasetName: string): string;
  getDatasetYamlPath(datasetName: string): string;
  getAudioDir(datasetName: string): string;
  initDataset(
    datasetName: string,
    description?: string,
  ): Effect.Effect<DatasetManifest, ValidationError>;
  loadManifest(
    datasetName: string,
  ): Effect.Effect<DatasetManifest, DatasetNotFoundError | ValidationError>;
  saveManifest(
    datasetName: string,
    manifest: DatasetManifest,
  ): Effect.Effect<void, ValidationError>;
  scanNewAudioFiles(
    datasetName: string,
  ): Effect.Effect<{ added: number; total: number }, DatasetNotFoundError | ValidationError>;
  getItem(
    datasetName: string,
    itemId: string,
  ): Effect.Effect<DatasetItem, DatasetNotFoundError | DatasetItemNotFoundError | ValidationError>;
  updateItem(
    datasetName: string,
    itemId: string,
    updates: Partial<DatasetItem>,
  ): Effect.Effect<DatasetItem, DatasetNotFoundError | DatasetItemNotFoundError | ValidationError>;
}

export class DatasetRepo extends Context.Tag("DatasetRepo")<DatasetRepo, DatasetRepoShape>() {}

export const DatasetRepoLive = Layer.succeed(
  DatasetRepo,
  DatasetRepo.of({
    getDatasetDir(datasetName: string): string {
      return path.resolve(process.cwd(), "datasets", datasetName);
    },

    getDatasetYamlPath(datasetName: string): string {
      return path.resolve(this.getDatasetDir(datasetName), "dataset.yaml");
    },

    getAudioDir(datasetName: string): string {
      return path.resolve(this.getDatasetDir(datasetName), "audio");
    },

    initDataset(datasetName: string, description?: string) {
      return Effect.gen(this, function* () {
        const datasetDir = this.getDatasetDir(datasetName);
        const audioDir = this.getAudioDir(datasetName);
        const yamlPath = this.getDatasetYamlPath(datasetName);

        if (!fs.existsSync(datasetDir)) {
          fs.mkdirSync(datasetDir, { recursive: true });
        }
        if (!fs.existsSync(audioDir)) {
          fs.mkdirSync(audioDir, { recursive: true });
        }

        const now = new Date().toISOString();
        const initialManifest: DatasetManifest = {
          name: datasetName,
          description: description ?? `Private benchmark dataset: ${datasetName}`,
          createdAt: now,
          updatedAt: now,
          items: [],
        };

        if (!fs.existsSync(yamlPath)) {
          fs.writeFileSync(yamlPath, yaml.stringify(initialManifest), "utf-8");
        }

        return initialManifest;
      });
    },

    loadManifest(datasetName: string) {
      return Effect.gen(this, function* () {
        const yamlPath = this.getDatasetYamlPath(datasetName);
        if (!fs.existsSync(yamlPath)) {
          return yield* Effect.fail(
            new DatasetNotFoundError({
              datasetName,
              path: yamlPath,
            }),
          );
        }

        let rawParsed: unknown;
        try {
          const content = fs.readFileSync(yamlPath, "utf-8");
          rawParsed = yaml.parse(content);
        } catch (err) {
          return yield* Effect.fail(
            new ValidationError({
              message: `Failed to parse YAML file at ${yamlPath}: ${String(err)}`,
              details: err,
            }),
          );
        }

        const decoded = Schema.decodeUnknownEither(DatasetManifestSchema)(rawParsed);
        if (decoded._tag === "Left") {
          return yield* Effect.fail(
            new ValidationError({
              message: `Schema validation failed for dataset ${datasetName}: ${JSON.stringify(decoded.left)}`,
              details: decoded.left,
            }),
          );
        }

        return decoded.right;
      });
    },

    saveManifest(datasetName: string, manifest: DatasetManifest) {
      return Effect.gen(this, function* () {
        const yamlPath = this.getDatasetYamlPath(datasetName);
        const updatedManifest: DatasetManifest = {
          ...manifest,
          updatedAt: new Date().toISOString(),
        };

        try {
          const yamlStr = yaml.stringify(updatedManifest);
          fs.writeFileSync(yamlPath, yamlStr, "utf-8");
        } catch (err) {
          return yield* Effect.fail(
            new ValidationError({
              message: `Failed to write dataset.yaml at ${yamlPath}: ${String(err)}`,
              details: err,
            }),
          );
        }
      });
    },

    scanNewAudioFiles(datasetName: string) {
      return Effect.gen(this, function* () {
        const manifest = yield* this.loadManifest(datasetName);
        const audioDir = this.getAudioDir(datasetName);

        if (!fs.existsSync(audioDir)) {
          fs.mkdirSync(audioDir, { recursive: true });
        }

        const existingPaths = new Set(manifest.items.map((i) => i.audioPath));
        const files = fs.readdirSync(audioDir);
        const newItems: DatasetItem[] = [];

        for (const file of files) {
          if (!isAudioFile(file)) continue;
          const relativePath = path.posix.join("audio", file);
          if (!existingPaths.has(relativePath)) {
            const id = path.basename(file, path.extname(file));
            const now = new Date().toISOString();
            newItems.push({
              id,
              audioPath: relativePath,
              groundTruth: "",
              draftTranscript: undefined,
              expectedTerms: [],
              keyPoints: [],
              verified: false,
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        if (newItems.length > 0) {
          const updatedManifest: DatasetManifest = {
            ...manifest,
            items: [...manifest.items, ...newItems],
            updatedAt: new Date().toISOString(),
          };
          yield* this.saveManifest(datasetName, updatedManifest);
        }

        return {
          added: newItems.length,
          total: manifest.items.length + newItems.length,
        };
      });
    },

    getItem(datasetName: string, itemId: string) {
      return Effect.gen(this, function* () {
        const manifest = yield* this.loadManifest(datasetName);
        const item = manifest.items.find((i) => i.id === itemId);
        if (!item) {
          return yield* Effect.fail(
            new DatasetItemNotFoundError({
              datasetName,
              itemId,
            }),
          );
        }
        return item;
      });
    },

    updateItem(datasetName: string, itemId: string, updates: Partial<DatasetItem>) {
      return Effect.gen(this, function* () {
        const manifest = yield* this.loadManifest(datasetName);
        const itemIdx = manifest.items.findIndex((i) => i.id === itemId);
        if (itemIdx === -1) {
          return yield* Effect.fail(
            new DatasetItemNotFoundError({
              datasetName,
              itemId,
            }),
          );
        }

        const currentItem = manifest.items[itemIdx]!;
        const updatedItem: DatasetItem = {
          ...currentItem,
          ...updates,
          id: currentItem.id, // ID cannot be overwritten
          updatedAt: new Date().toISOString(),
        };

        const updatedItems = manifest.items.map((it) => (it.id === itemId ? updatedItem : it));
        const updatedManifest: DatasetManifest = {
          ...manifest,
          items: updatedItems,
          updatedAt: new Date().toISOString(),
        };
        yield* this.saveManifest(datasetName, updatedManifest);
        return updatedItem;
      });
    },
  }),
);
