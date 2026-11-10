/** An HTTP response with a non-2xx status. `retryAfterMs` comes from the Retry-After header. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}`);
  }
}

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injected for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; defaults to Math.random. */
  random?: () => number;
  /** Extra veto: return false to stop retrying an error that would otherwise be retried. */
  shouldRetry?: (error: unknown) => boolean;
};

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 429 and 5xx are worth retrying; other 4xx (bad slug, bad request) are not. Network errors are. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 429 || error.status >= 500;
  return true;
}

/** Delay before the next attempt: Retry-After if the server sent one, else exponential backoff with full jitter. */
export function retryDelayMs(error: unknown, attempt: number, options: Required<Omit<RetryOptions, "sleep" | "shouldRetry">>): number {
  if (error instanceof HttpError && error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, options.maxDelayMs);
  }
  const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
  return Math.floor(options.random() * ceiling);
}

/** Runs `operation`, retrying retryable failures up to `attempts` total tries. */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const settings = {
    attempts: options.attempts ?? 3,
    baseDelayMs: options.baseDelayMs ?? 400,
    maxDelayMs: options.maxDelayMs ?? 4_000,
    random: options.random ?? Math.random,
  };
  const sleep = options.sleep ?? realSleep;

  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attempt >= settings.attempts - 1;
      const vetoed = options.shouldRetry ? !options.shouldRetry(error) : false;
      if (isLastAttempt || vetoed || !isRetryable(error)) throw error;
      await sleep(retryDelayMs(error, attempt, settings));
    }
  }
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export type FetchJsonOptions = RetryOptions & {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** GETs JSON with a per-attempt timeout and retries. Throws HttpError for non-2xx responses. */
export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  return withRetry(async () => {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new HttpError(response.status, url, parseRetryAfter(response.headers.get("retry-after")));
    }
    return (await response.json()) as T;
  }, options);
}
