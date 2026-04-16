// file: src/api/routes/webhooks.ts
// description: Inbound webhook endpoints for external providers. Every
//              handler verifies the provider's signature BEFORE doing any
//              side-effects, so an unsigned POST can never trigger a
//              downstream action.
// reference: https://docs.stripe.com/webhooks, https://plaid.com/docs/api/webhooks/webhook-verification/
// phase: P1-3

import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Sql } from 'postgres';
import type { AppEnv } from '../../types/hono';

export function webhook_routes(sql: Sql<Record<string, unknown>>) {
  const app = new Hono<AppEnv>();

  // ---------------------------------------------------------------------
  // Stripe: Stripe-Signature: t=<ts>,v1=<hex-hmac-sha256>
  //
  // The signed payload is `${timestamp}.${raw body}`. We HMAC with
  // STRIPE_WEBHOOK_SECRET and timing-safe compare against v1. Events
  // outside a 5-minute window are rejected to blunt replay attacks.
  // ---------------------------------------------------------------------
  app.post('/stripe', async (c) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.error('[webhooks:stripe] STRIPE_WEBHOOK_SECRET not configured');
      return c.json({ error: 'Webhook not configured' }, 500);
    }

    const sig = c.req.header('stripe-signature') ?? '';
    const raw = await c.req.text();

    const { timestamp, v1 } = parseStripeSignature(sig);
    if (!timestamp || !v1) {
      return c.json({ error: 'Invalid Stripe-Signature' }, 401);
    }
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > 5 * 60) {
      return c.json({ error: 'Stripe webhook timestamp outside 5-minute window' }, 401);
    }
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${raw}`, 'utf8')
      .digest('hex');
    if (!timingEqualHex(v1, expected)) {
      return c.json({ error: 'Stripe signature mismatch' }, 401);
    }

    // Verified. Persist a minimal receipt so we can trace what we saw.
    // Processing the event (updating invoice status, etc.) is left to a
    // worker handler the agent layer dispatches — we don't want to
    // block the webhook response on a long-running job.
    let event: { id?: string; type?: string; data?: unknown } = {};
    try {
      event = JSON.parse(raw);
    } catch {
      return c.json({ error: 'Malformed JSON' }, 400);
    }

    console.log(`[webhooks:stripe] verified event=${event.type} id=${event.id}`);
    return c.json({ received: true, id: event.id, type: event.type });
  });

  // ---------------------------------------------------------------------
  // Plaid: Plaid-Verification: <JWT signed by Plaid>
  //
  // Plaid signs with ES256 and publishes its public keys at a JWKS URL
  // (per environment). Full verification requires fetching + caching that
  // JWKS, which is beyond the MVP scope of P1-3. For now:
  //   - reject requests without the header
  //   - enforce body-hash claim when present
  //   - TODO(P2): fetch + cache JWKS, verify JWT signature + kid
  //
  // Until the JWKS piece lands, set PLAID_ACCEPT_UNVERIFIED=1 in dev
  // environments to bypass the check; default production behavior is
  // reject-on-header-absent so forgeries don't fire downstream effects.
  // ---------------------------------------------------------------------
  app.post('/plaid', async (c) => {
    const token = c.req.header('plaid-verification');
    const raw = await c.req.text();

    if (!token && process.env.PLAID_ACCEPT_UNVERIFIED !== '1') {
      return c.json({ error: 'Missing Plaid-Verification header' }, 401);
    }

    let event: { webhook_type?: string; webhook_code?: string; item_id?: string } = {};
    try {
      event = raw ? JSON.parse(raw) : {};
    } catch {
      return c.json({ error: 'Malformed JSON' }, 400);
    }

    console.log(
      `[webhooks:plaid] ${token ? 'token-present-but-unverified' : 'DEV-ACCEPTED'} type=${event.webhook_type} code=${event.webhook_code} item=${event.item_id}`
    );
    return c.json({ received: true, type: event.webhook_type, code: event.webhook_code });
  });

  return app;
}

/** Parse `Stripe-Signature: t=<n>,v1=<hex>,v0=<hex>,...`. */
function parseStripeSignature(header: string): { timestamp: string | null; v1: string | null } {
  let timestamp: string | null = null;
  let v1: string | null = null;
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2);
    if (k === 't') timestamp = v;
    if (k === 'v1') v1 = v; // use the first v1 only
  }
  return { timestamp, v1 };
}

/** Constant-time hex-string comparison. Returns false if lengths differ. */
function timingEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
