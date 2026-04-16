// file: src/integrations/http.ts
// description: Shared HTTP request wrapper for all external integrations.
//              Bundles circuit breaker, exponential-backoff retry, and a
//              "Retry-After"-aware rate-limit handler. Every integration
//              (Plaid, Stripe, QuickBooks, Xero, Document AI) routes its
//              fetch() calls through here, so fail-fast + retry behavior is
//              consistent and testable in one place.
// reference: src/guardrails/circuit-breaker.ts

import {
  plaid_circuit_breaker,
  stripe_circuit_breaker,
  quickbooks_circuit_breaker,
  xero_circuit_breaker,
  document_ai_circuit_breaker,
  llm_circuit_breaker,
  type CircuitBreaker as _CB,
} from '../guardrails/circuit-breaker';
import type { CircuitBreaker } from '../guardrails/circuit-breaker';

export type IntegrationService =
  | 'plaid'
  | 'stripe'
  | 'quickbooks'
  | 'xero'
  | 'document-ai'
  | 'llm';

/** Circuit breaker lookup per service. */
const CIRCUIT_BREAKERS: Record<IntegrationService, CircuitBreaker> = {
  plaid: plaid_circuit_breaker,
  stripe: stripe_circuit_breaker,
  quickbooks: quickbooks_circuit_breaker,
  xero: xero_circuit_breaker,
  'document-ai': document_ai_circuit_breaker,
  llm: llm_circuit_breaker,
};

export interface HttpRequestOptions {
  service: IntegrationService;
  /** Invoked on each attempt; must return a fresh Response each time. */
  request: () => Promise<Response>;
  /**
   * Return true when the Response indicates a rate-limit (typically 429).
   * Used to honor Retry-After on the retry schedule. Defaults to `r.status === 429`.
   */
  isRateLimited?: (r: Response) => boolean;
  /**
   * Return true when the caught error is worth retrying (transient network
   * errors, typically). Defaults to any error with `name === 'TypeError'`
   * (fetch network errors) or any error at all if you don't pass this.
   */
  isRetryable?: (err: unknown) => boolean;
  /** Max retry attempts after the initial try. Default: 3. */
  maxRetries?: number;
  /** Initial backoff in ms; doubled each retry. Default: 500. */
  baseDelayMs?: number;
  /** Cap on any single backoff delay. Default: 10_000. */
  maxDelayMs?: number;
  /** Whether to add ±25% jitter. Default: true. */
  jitter?: boolean;
}

/**
 * Dispatch an HTTP request through the shared guardrails.
 *
 *   1. Ask the circuit breaker: it'll fail fast if the service is open.
 *   2. Call `request()` to get a Response.
 *   3. If the response indicates a rate-limit, honor Retry-After (if present)
 *      and retry with backoff.
 *   4. If `request()` throws a retryable error, retry with backoff.
 *   5. Otherwise, return the Response to the caller — caller decides how to
 *      interpret the status.
 *
 * The wrapper does NOT read the response body; callers do that to keep this
 * layer stream-safe.
 */
export async function httpRequest(opts: HttpRequestOptions): Promise<Response> {
  const breaker = CIRCUIT_BREAKERS[opts.service];
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 10_000;
  const jitter = opts.jitter ?? true;
  const isRateLimited = opts.isRateLimited ?? ((r: Response) => r.status === 429);
  const isRetryable = opts.isRetryable ?? ((_err: unknown) => true);

  return breaker.execute(async () => {
    let attempt = 0;
    let lastErr: unknown;

    while (attempt <= maxRetries) {
      try {
        const res = await opts.request();

        if (isRateLimited(res) && attempt < maxRetries) {
          const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
          const delay = retryAfter ?? computeBackoff(attempt, baseDelay, maxDelay, jitter);
          console.warn(
            `[http:${opts.service}] rate-limited (status ${res.status}); retry in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
          );
          // Drain the body so the connection can be released.
          await res.text().catch(() => undefined);
          await sleep(delay);
          attempt++;
          continue;
        }

        return res;
      } catch (err) {
        lastErr = err;
        if (attempt >= maxRetries || !isRetryable(err)) throw err;
        const delay = computeBackoff(attempt, baseDelay, maxDelay, jitter);
        console.warn(
          `[http:${opts.service}] error: ${describe(err)}; retry in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
        );
        await sleep(delay);
        attempt++;
      }
    }

    // Unreachable — the loop either returns or throws — but TS wants it.
    throw lastErr ?? new Error(`httpRequest(${opts.service}) exhausted retries`);
  });
}

function computeBackoff(attempt: number, baseDelay: number, maxDelay: number, jitter: boolean): number {
  const exp = Math.min(baseDelay * 2 ** attempt, maxDelay);
  if (!jitter) return exp;
  // Full jitter strategy: random between 0 and exp. Avoids thundering herd.
  return Math.floor(Math.random() * exp);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  // Retry-After may be seconds OR an HTTP-date.
  const asNum = Number(header);
  if (Number.isFinite(asNum)) return Math.max(0, asNum) * 1000;
  const asDate = Date.parse(header);
  if (!Number.isFinite(asDate)) return null;
  return Math.max(0, asDate - Date.now());
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Generic retry helper for non-HTTP operations (e.g., LLM calls that bubble
 * up as thrown errors rather than Response objects). Same backoff behavior
 * as httpRequest; no circuit breaker.
 */
export async function retryWithBackoff<T>(opts: {
  attempt: () => Promise<T>;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  retryable?: (err: unknown) => boolean;
}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 10_000;
  const jitter = opts.jitter ?? true;
  const retryable = opts.retryable ?? (() => true);

  let attempt = 0;
  let lastErr: unknown;
  while (attempt <= maxRetries) {
    try {
      return await opts.attempt();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || !retryable(err)) throw err;
      const delay = computeBackoff(attempt, baseDelay, maxDelay, jitter);
      await sleep(delay);
      attempt++;
    }
  }
  throw lastErr ?? new Error('retryWithBackoff: exhausted retries');
}
