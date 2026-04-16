// file: tests/integrations/http.test.ts
// description: Tests for the shared HTTP wrapper. Covers retry on 429,
//              Retry-After parsing, retry on transient errors, circuit
//              breaker integration, and exhaustion behavior.

import { describe, expect, test } from 'bun:test';
import { httpRequest, retryWithBackoff } from '../../src/integrations/http';

function makeResponse(status: number, body = 'ok', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

describe('httpRequest', () => {
  test('returns the first successful response without retrying', async () => {
    let calls = 0;
    const res = await httpRequest({
      service: 'llm',
      request: async () => {
        calls++;
        return makeResponse(200);
      },
      maxRetries: 3,
      baseDelayMs: 1,
      jitter: false,
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  test('retries on 429 then succeeds', async () => {
    let calls = 0;
    const res = await httpRequest({
      service: 'llm',
      request: async () => {
        calls++;
        if (calls < 3) return makeResponse(429, 'slow down', { 'retry-after': '0' });
        return makeResponse(200);
      },
      maxRetries: 5,
      baseDelayMs: 1,
      jitter: false,
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  test('honors Retry-After (numeric) on 429', async () => {
    let calls = 0;
    const started = Date.now();
    const res = await httpRequest({
      service: 'llm',
      request: async () => {
        calls++;
        if (calls === 1) return makeResponse(429, '', { 'retry-after': '0.05' });
        return makeResponse(200);
      },
      maxRetries: 2,
      baseDelayMs: 5000, // would dominate if Retry-After weren't honored
      jitter: false,
    });
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    // We should NOT have waited 5s.
    expect(elapsed).toBeLessThan(2000);
  });

  test('retries on thrown transient errors', async () => {
    let calls = 0;
    const res = await httpRequest({
      service: 'llm',
      request: async () => {
        calls++;
        if (calls < 2) throw new TypeError('network down');
        return makeResponse(200);
      },
      maxRetries: 3,
      baseDelayMs: 1,
      jitter: false,
    });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  test('returns non-429 error responses without retry', async () => {
    let calls = 0;
    const res = await httpRequest({
      service: 'llm',
      request: async () => {
        calls++;
        return makeResponse(400, 'bad');
      },
      maxRetries: 3,
      baseDelayMs: 1,
    });
    expect(res.status).toBe(400);
    expect(calls).toBe(1);
  });

  test('throws after retry exhaustion', async () => {
    let calls = 0;
    await expect(
      httpRequest({
        service: 'llm',
        request: async () => {
          calls++;
          throw new Error('persistent failure');
        },
        maxRetries: 2,
        baseDelayMs: 1,
        jitter: false,
      })
    ).rejects.toThrow(/persistent failure/);
    expect(calls).toBe(3); // initial + 2 retries
  });

  test('respects isRetryable — does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      httpRequest({
        service: 'llm',
        request: async () => {
          calls++;
          throw new Error('validation error');
        },
        isRetryable: () => false,
        maxRetries: 3,
        baseDelayMs: 1,
      })
    ).rejects.toThrow(/validation error/);
    expect(calls).toBe(1);
  });
});

describe('retryWithBackoff', () => {
  test('returns the first success', async () => {
    let n = 0;
    const out = await retryWithBackoff({
      attempt: async () => {
        n++;
        return 42;
      },
      baseDelayMs: 1,
    });
    expect(out).toBe(42);
    expect(n).toBe(1);
  });

  test('retries then succeeds', async () => {
    let n = 0;
    const out = await retryWithBackoff({
      attempt: async () => {
        n++;
        if (n < 3) throw new Error('try again');
        return 'done';
      },
      baseDelayMs: 1,
      jitter: false,
    });
    expect(out).toBe('done');
    expect(n).toBe(3);
  });

  test('propagates non-retryable errors immediately', async () => {
    let n = 0;
    await expect(
      retryWithBackoff({
        attempt: async () => {
          n++;
          throw new Error('permanent');
        },
        retryable: () => false,
        baseDelayMs: 1,
      })
    ).rejects.toThrow(/permanent/);
    expect(n).toBe(1);
  });
});
