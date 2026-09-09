import WebSocket from "ws";
import { Effect } from "effect";
import { JudgeConnectionError, JudgeEvaluationError } from "../errors.js";
import type { TokenUsage } from "../schemas/asr.js";

/**
 * Codex frames arrive as text, a Buffer, or a list of Buffers depending on how
 * the server chunks them; normalise all of those to the JSON text we parse.
 */
const frameToText = (data: WebSocket.Data): string => {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(data).toString("utf8");
};

interface CodexTokenUsageBreakdown {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
}

export interface CodexGenerateParams {
  model: string;
  prompt: string;
  temperature?: number;
}

export interface CodexGenerateResult {
  text: string;
  /** Token usage reported by the app server for the judge turn, when available. */
  usage?: TokenUsage;
}

export interface CodexClient {
  generate(
    params: CodexGenerateParams,
  ): Effect.Effect<CodexGenerateResult, JudgeConnectionError | JudgeEvaluationError>;
}

export class WebSocketCodexClient implements CodexClient {
  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs = 600_000,
  ) {}

  generate(params: CodexGenerateParams) {
    return Effect.gen(this, function* () {
      // Accept the short alias "Luna" for the exact model ID "gpt-5.6-luna"
      const modelId =
        params.model.toLowerCase() === "luna" || params.model === "gpt-5.6-luna"
          ? "gpt-5.6-luna"
          : params.model;

      const result = yield* Effect.tryPromise({
        try: () =>
          new Promise<CodexGenerateResult>((resolve, reject) => {
            const socket = new WebSocket(this.endpoint);
            let resolved = false;
            let threadId: string | null = null;
            let finalAnswerText = "";
            let usage: TokenUsage | undefined;

            const timeout = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                socket.close();
                reject(
                  new Error(
                    `Codex App Server timeout after ${Math.round(this.timeoutMs / 1000)}s at ${this.endpoint}. Ensure server is running with 'codex app-server --listen ${this.endpoint}'`,
                  ),
                );
              }
            }, this.timeoutMs);

            socket.on("open", () => {
              // 1. Initialize
              socket.send(
                JSON.stringify({
                  jsonrpc: "2.0",
                  id: 1,
                  method: "initialize",
                  params: {
                    clientInfo: { name: "kikitori-bench", version: "0.1.0" },
                  },
                }),
              );
            });

            socket.on("message", (data: WebSocket.Data) => {
              if (resolved) return;
              try {
                const msg = JSON.parse(frameToText(data)) as {
                  id?: number;
                  method?: string;
                  result?: {
                    thread?: { id?: string };
                    id?: string;
                    threadId?: string;
                  };
                  params?: {
                    delta?: string;
                    tokenUsage?: {
                      last?: CodexTokenUsageBreakdown;
                      total?: CodexTokenUsageBreakdown;
                    };
                    item?: {
                      type?: string;
                      text?: string;
                      content?: Array<{ type?: string; text?: string }>;
                    };
                  };
                  error?: { message?: string };
                };

                type TurnFailure = {
                  error?: { message?: string; codexErrorInfo?: string };
                  turn?: { status?: string; error?: { message?: string; codexErrorInfo?: string } };
                };

                if (msg.error) {
                  resolved = true;
                  clearTimeout(timeout);
                  socket.close();
                  reject(new Error(`Codex App Server error: ${msg.error.message}`));
                  return;
                }

                // A failed turn carries the real reason (usage limit, auth, ...)
                // in its own error field. Without reading it the client reports
                // a useless "no agent message" and retries something that can
                // never succeed.
                const failure = msg.params as TurnFailure | undefined;
                const turnError = failure?.error ?? failure?.turn?.error;
                if (turnError?.message) {
                  resolved = true;
                  clearTimeout(timeout);
                  socket.close();
                  const code = turnError.codexErrorInfo ? ` [${turnError.codexErrorInfo}]` : "";
                  reject(new Error(`Codex App Server turn failed${code}: ${turnError.message}`));
                  return;
                }

                // Initialized -> Start thread
                if (msg.id === 1) {
                  socket.send(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      id: 2,
                      method: "thread/start",
                      params: {
                        model: modelId,
                        ephemeral: true,
                      },
                    }),
                  );
                  return;
                }

                // Thread started -> Start turn
                if (msg.id === 2 && msg.result) {
                  threadId = msg.result.thread?.id ?? msg.result.threadId ?? msg.result.id ?? null;
                  if (!threadId) {
                    resolved = true;
                    clearTimeout(timeout);
                    socket.close();
                    reject(new Error("Failed to obtain thread ID from Codex App Server"));
                    return;
                  }

                  socket.send(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      id: 3,
                      method: "turn/start",
                      params: {
                        threadId,
                        input: [{ type: "text", text: params.prompt }],
                      },
                    }),
                  );
                  return;
                }

                // Token usage snapshot for the thread (cumulative "total")
                if (msg.method === "thread/tokenUsage/updated" && msg.params?.tokenUsage) {
                  const breakdown = msg.params.tokenUsage.total ?? msg.params.tokenUsage.last;
                  if (breakdown) {
                    usage = {
                      inputTokens: breakdown.inputTokens,
                      cachedInputTokens: breakdown.cachedInputTokens,
                      outputTokens: breakdown.outputTokens,
                      reasoningOutputTokens: breakdown.reasoningOutputTokens,
                      totalTokens: breakdown.totalTokens,
                    };
                  }
                }

                // Accumulate agentMessage deltas
                if (msg.method === "item/agentMessage/delta" && msg.params?.delta) {
                  finalAnswerText += msg.params.delta;
                }

                // Check for agentMessage or assistantMessage completion
                if (msg.method === "item/completed" && msg.params?.item) {
                  const item = msg.params.item;
                  if (
                    (item.type === "agentMessage" || item.type === "assistantMessage") &&
                    item.text
                  ) {
                    finalAnswerText = item.text;
                  }
                }

                // Turn completed
                if (msg.method === "turn/completed" || msg.method === "turn/ended") {
                  resolved = true;
                  clearTimeout(timeout);
                  socket.close();
                  if (finalAnswerText.trim()) {
                    resolve({ text: finalAnswerText.trim(), usage });
                  } else {
                    reject(
                      new Error(
                        "Turn completed but no agent message was returned by Codex App Server",
                      ),
                    );
                  }
                }
              } catch {
                // Ignore transient frame parse errors
              }
            });

            socket.on("error", (err) => {
              if (resolved) return;
              resolved = true;
              clearTimeout(timeout);
              reject(
                new Error(
                  `Cannot connect to Codex App Server at ${this.endpoint}: ${err.message}. Is 'codex app-server --listen ${this.endpoint}' running?`,
                ),
              );
            });
          }),
        catch: (err) =>
          new JudgeConnectionError({
            endpoint: this.endpoint,
            message: String(err),
            cause: err,
          }),
      });

      return result;
    });
  }
}

/**
 * Errors that no amount of retrying will fix: retrying a usage-limit failure
 * across hundreds of samples just burns wall-clock before failing anyway.
 */
export const isFatalJudgeError = (error: { message?: string }): boolean =>
  /usageLimitExceeded|usage limit|unauthorized|invalid_api_key|not logged in/i.test(
    error.message ?? "",
  );

/**
 * MockCodexClient for testing and offline execution
 */
export class MockCodexClient implements CodexClient {
  generate(_params: CodexGenerateParams) {
    return Effect.sync(() => {
      // Return a valid JSON response with 4 global checks
      const text = JSON.stringify({
        terms: [],
        keyPoints: [
          {
            index: 1,
            verdict: "present",
            reason: "[Mock Judge] The proposition is conveyed.",
          },
        ],
        insertions: [],
      });
      return {
        text,
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
        },
      };
    });
  }
}
