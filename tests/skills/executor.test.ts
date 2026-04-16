// file: tests/skills/executor.test.ts
// description: Unit tests for the skills executor: registration, input/output
//              validation, PII redaction hook, error wrapping.

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import type { Sql } from 'postgres';
import {
  invokeSkill,
  registerSkill,
  SkillInputError,
  SkillNotFoundError,
  SkillOutputError,
  type SkillContext,
  type SkillDefinition,
} from '../../src/skills';

// A minimal context — no real DB needed for these tests.
const ctx: SkillContext = {
  tenant_id: 'tenant-x',
  user_id: 'user-x',
  role: 'accountant',
  sql: {} as Sql<Record<string, unknown>>,
};

// Register a test-only skill that echoes its input, with a PII hook.
const echoSkill: SkillDefinition<{ text: string }, { echoed: string }> = {
  name: 'test-echo',
  description: 'Echoes input.text',
  inputSchema: z.object({ text: z.string().min(1) }),
  outputSchema: z.object({ echoed: z.string() }),
  redactPII: (input) => ({ ...input, text: input.text.replace(/\d{3}-\d{2}-\d{4}/g, '[SSN]') }),
  handler: async (input) => ({ echoed: input.text }),
};
registerSkill(echoSkill);

// A broken skill: its handler returns the wrong shape.
const brokenSkill: SkillDefinition<{ n: number }, { ok: boolean }> = {
  name: 'test-broken',
  description: 'Always returns bad output',
  inputSchema: z.object({ n: z.number() }),
  outputSchema: z.object({ ok: z.boolean() }),
  handler: async () => ({ wrong: 'shape' }) as unknown as { ok: boolean },
};
registerSkill(brokenSkill);

describe('invokeSkill', () => {
  test('returns validated output for valid input', async () => {
    const out = await invokeSkill<{ echoed: string }>(
      'test-echo',
      { text: 'hello' },
      ctx
    );
    expect(out.echoed).toBe('hello');
  });

  test('applies PII redaction before handler', async () => {
    const out = await invokeSkill<{ echoed: string }>(
      'test-echo',
      { text: 'SSN is 123-45-6789' },
      ctx
    );
    expect(out.echoed).toBe('SSN is [SSN]');
  });

  test('throws SkillNotFoundError for unknown skill', async () => {
    await expect(invokeSkill('does-not-exist', {}, ctx)).rejects.toBeInstanceOf(
      SkillNotFoundError
    );
  });

  test('throws SkillInputError for invalid input', async () => {
    await expect(
      invokeSkill('test-echo', { text: '' }, ctx)
    ).rejects.toBeInstanceOf(SkillInputError);
    await expect(
      invokeSkill('test-echo', { wrong_field: 'x' }, ctx)
    ).rejects.toBeInstanceOf(SkillInputError);
  });

  test('throws SkillOutputError when handler returns wrong shape', async () => {
    await expect(
      invokeSkill('test-broken', { n: 1 }, ctx)
    ).rejects.toBeInstanceOf(SkillOutputError);
  });

  test('invoice-processor and payment-gateway are registered', async () => {
    const { listSkills } = await import('../../src/skills');
    const names = listSkills();
    expect(names).toContain('invoice-processor');
    expect(names).toContain('payment-gateway');
  });

  test('payment-gateway returns synthetic response when STRIPE_SECRET_KEY is unset', async () => {
    const originalKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const out = await invokeSkill<{
        mode: 'live' | 'synthetic';
        idempotency_key: string;
        payment_intent_id: string;
      }>(
        'payment-gateway',
        {
          invoice_id: '00000000-0000-0000-0000-000000000001',
          amount_cents: 12345,
          currency: 'usd',
        },
        ctx
      );
      expect(out.mode).toBe('synthetic');
      expect(out.idempotency_key).toMatch(/^[0-9a-f]{64}$/);
      expect(out.payment_intent_id).toMatch(/^pi_synthetic_/);
    } finally {
      if (originalKey !== undefined) process.env.STRIPE_SECRET_KEY = originalKey;
    }
  });

  test('payment-gateway idempotency key is deterministic', async () => {
    const originalKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const input = {
        invoice_id: '00000000-0000-0000-0000-000000000001',
        amount_cents: 12345,
        currency: 'usd',
      };
      const a = await invokeSkill<{ idempotency_key: string }>('payment-gateway', input, ctx);
      const b = await invokeSkill<{ idempotency_key: string }>('payment-gateway', input, ctx);
      expect(a.idempotency_key).toBe(b.idempotency_key);
    } finally {
      if (originalKey !== undefined) process.env.STRIPE_SECRET_KEY = originalKey;
    }
  });
});
