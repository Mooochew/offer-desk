import "server-only";

import OpenAI, { APIError } from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { getServerEnv } from "@/lib/env/server";
import { HttpError, parseRetryAfter, withRetry, type RetryOptions } from "@/lib/http/retry";

/** The daily OpenAI request cap for the whole app was reached (DECISIONS 003). */
export class QuotaExceededError extends Error {
  constructor(readonly limit: number) {
    super(`Daily AI request limit (${limit}) reached. Try again tomorrow.`);
  }
}

/** The quota counter couldn't be read. Fails closed (no model call) and is not retried. */
export class QuotaCounterError extends Error {
  constructor(detail: string) {
    super(`quota counter failed: ${detail}`);
  }
}

/** The part of a Responses API result the app uses. */
export type LlmResponse = { output_text: string; status?: string | null; usage?: { input_tokens: number; output_tokens: number } | null };

/** Calls the model once. Injected so tests and evals can swap it. */
export type CreateResponse = (params: ResponseCreateParamsNonStreaming) => Promise<LlmResponse>;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  // SDK retries are off: retries go through withRetry so every API call shares one policy
  // (429/5xx, Retry-After, jitter) and one place to count quota.
  // 20 s per attempt x 2 attempts keeps one slow extraction from eating a whole request (review S6).
  client ??= new OpenAI({ apiKey: getServerEnv().openaiApiKey, maxRetries: 0, timeout: 20_000 });
  return client;
}

/** Converts SDK errors into HttpError so the shared retry policy can read status and Retry-After. */
export function toHttpError(error: unknown): unknown {
  if (error instanceof APIError && typeof error.status === "number") {
    const retryAfter = error.headers instanceof Headers ? parseRetryAfter(error.headers.get("retry-after")) : null;
    return new HttpError(error.status, "https://api.openai.com/v1/responses", retryAfter);
  }
  return error;
}

export type CreateResponseOptions = RetryOptions & {
  /** Called before every attempt; throws QuotaExceededError when the daily cap is used up. */
  countRequest?: () => Promise<void>;
  /** Injected for tests; defaults to the real OpenAI client. */
  send?: (params: ResponseCreateParamsNonStreaming) => Promise<LlmResponse>;
};

/**
 * Builds a `CreateResponse` with retries for 429/5xx/network errors and a quota check per attempt.
 * Quota errors are never retried.
 */
export function createResponder(options: CreateResponseOptions = {}): CreateResponse {
  const send = options.send ?? ((params) => getClient().responses.create(params));
  return (params) =>
    withRetry(
      async () => {
        await options.countRequest?.();
        try {
          return await send(params);
        } catch (error) {
          throw toHttpError(error);
        }
      },
      {
        attempts: 2,
        ...options,
        shouldRetry: (error) => !(error instanceof QuotaExceededError || error instanceof QuotaCounterError),
      },
    );
}
