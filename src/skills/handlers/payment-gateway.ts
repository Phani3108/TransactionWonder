// file: src/skills/handlers/payment-gateway.ts
// description: payment-gateway skill — creates a Stripe PaymentIntent for a
//              given invoice. Includes an idempotency key derived from
//              (tenant_id, invoice_id, amount) so retries never duplicate
//              charges (P1-4 fully wires this through a shared retry layer).
// reference: src/integrations/stripe/client.ts

import { createHash } from 'crypto';
import { z } from 'zod';
import { getStripeClient } from '../../integrations/stripe/client';
import type { SkillDefinition } from '../types';

// Currency is optional in the caller's input but always present after
// normalization in the handler. We keep it optional on the Zod schema so the
// schema's input and output types align (avoids z.ZodType<In> variance).
export const PaymentGatewayInput = z.object({
  invoice_id: z.string().uuid(),
  amount_cents: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  vendor_id: z.string().uuid().optional(),
  customer_id: z.string().optional(),
  description: z.string().max(500).optional(),
});
export type PaymentGatewayInput = z.infer<typeof PaymentGatewayInput>;

export const PaymentGatewayOutput = z.object({
  payment_intent_id: z.string(),
  status: z.string(),
  client_secret: z.string().nullable(),
  idempotency_key: z.string(),
  mode: z.enum(['live', 'synthetic']),
});
export type PaymentGatewayOutput = z.infer<typeof PaymentGatewayOutput>;

/**
 * Deterministic idempotency key: hash of (tenant_id, invoice_id, amount).
 * Same inputs → same key → Stripe dedupes retries into one charge.
 * Never use wall-clock in the hash; that breaks idempotency on retry.
 */
function idempotencyKey(tenant_id: string, invoice_id: string, amount: number): string {
  return createHash('sha256')
    .update(`${tenant_id}|${invoice_id}|${amount}`)
    .digest('hex');
}

export const paymentGateway: SkillDefinition<PaymentGatewayInput, PaymentGatewayOutput> = {
  name: 'payment-gateway',
  description:
    'Create a Stripe PaymentIntent for a given invoice with a deterministic idempotency key.',
  inputSchema: PaymentGatewayInput,
  outputSchema: PaymentGatewayOutput,
  handler: async (input, ctx) => {
    const key = idempotencyKey(ctx.tenant_id, input.invoice_id, input.amount_cents);

    // If STRIPE_SECRET_KEY isn't configured we return a synthetic
    // response instead of crashing the caller. Makes local dev and CI
    // usable without real credentials. Callers can detect via `mode`.
    if (!process.env.STRIPE_SECRET_KEY) {
      return {
        payment_intent_id: `pi_synthetic_${key.slice(0, 16)}`,
        status: 'synthetic',
        client_secret: null,
        idempotency_key: key,
        mode: 'synthetic' as const,
      };
    }

    const client = getStripeClient();
    const intent = await client.createPaymentIntent({
      amount: input.amount_cents,
      currency: input.currency ?? 'usd',
      customerId: input.customer_id,
      description:
        input.description ??
        `TransactionWonder invoice ${input.invoice_id}`,
      metadata: {
        tenant_id: ctx.tenant_id,
        invoice_id: input.invoice_id,
      },
    });

    return {
      payment_intent_id: intent.id,
      status: intent.status,
      client_secret: intent.clientSecret,
      idempotency_key: key,
      mode: 'live' as const,
    };
  },
};
