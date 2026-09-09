import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import { Effect, Schema } from "effect";
import { AppConfigSchema, type AppConfig } from "./schemas/config.js";
import { ConfigError } from "./errors.js";

const DEFAULT_CONFIG: AppConfig = {
  judge: {
    provider: "codex",
    model: "gpt-5.6-luna",
    endpoint: "ws://127.0.0.1:4500",
    temperature: 0.0,
    concurrency: 3
  },
  weights: {
    proper_noun_f1: 0.30,
    proposition_quality: 0.70
  },
  models: {
    "gemini-flash": {
      type: "gemini",
      model: "gemini-3.8-flash",
      displayName: "Gemini 3.8 Flash"
    },
    "whisper-1": {
      type: "whisper",
      model: "whisper-1",
      displayName: "OpenAI Whisper"
    }
  },
  review: {
    port: 3000
  }
};

export const loadConfig = (configPath = "kikitori.config.yaml"): Effect.Effect<AppConfig, ConfigError> =>
  Effect.gen(function* () {
    const resolvedPath = path.resolve(process.cwd(), configPath);
    let parsedObj: unknown = DEFAULT_CONFIG;

    if (fs.existsSync(resolvedPath)) {
      try {
        const fileContent = fs.readFileSync(resolvedPath, "utf-8");
        parsedObj = yaml.parse(fileContent);
      } catch (err) {
        return yield* Effect.fail(
          new ConfigError({
            message: `Failed to read config file at ${resolvedPath}: ${String(err)}`,
            cause: err
          })
        );
      }
    }

    // Decode with Schema
    const decoded = Schema.decodeUnknownEither(AppConfigSchema)(parsedObj);
    if (decoded._tag === "Left") {
      return yield* Effect.fail(
        new ConfigError({
          message: `Invalid configuration structure in ${configPath}: ${JSON.stringify(decoded.left)}`,
          cause: decoded.left
        })
      );
    }

    const config = decoded.right;

    // Apply environment variable overrides if present
    const endpointEnv = process.env["CODEX_APP_SERVER_URL"];
    const modelEnv = process.env["CODEX_APP_SERVER_MODEL"];
    const reviewPortEnv = process.env["REVIEW_PORT"];

    return {
      ...config,
      judge: {
        ...config.judge,
        endpoint: endpointEnv ?? config.judge.endpoint,
        model: modelEnv ?? config.judge.model
      },
      review: {
        ...config.review,
        port: reviewPortEnv ? parseInt(reviewPortEnv, 10) : config.review.port
      }
    };
  });
