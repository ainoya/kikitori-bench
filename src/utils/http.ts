const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
}

/**
 * POST with backoff on rate limiting and transient server errors.
 *
 * Providers meter per minute, so a batch that is fine at 30 samples starts
 * getting 429s at 120: waiting is the correct response, dropping the sample is
 * not - a rate-limited request would otherwise be scored as an empty transcript.
 */
export const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  { attempts = 6, baseDelayMs = 2000 }: RetryOptions = {}
): Promise<Response> => {
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(url, init);
    if (response.status !== 429 && response.status < 500) return response;

    lastResponse = response;
    if (attempt === attempts - 1) break;

    // Honour the server's own hint when it gives one.
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : baseDelayMs * 2 ** attempt;
    await sleep(Math.min(delay, 60_000));
  }

  return lastResponse!;
};
