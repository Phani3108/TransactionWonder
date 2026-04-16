// file: src/skills/handlers/invoice-processor.ts
// description: invoice-processor skill — takes OCR text, returns a parsed
//              invoice via the LLM client. PII in the OCR text is redacted
//              before the LLM call.
// reference: src/core/llm-client.ts, src/guardrails/validators.ts

import { z } from 'zod';
import * as llm from '../../core/llm-client';
import { redact_pii } from '../../guardrails/validators';
import type { SkillDefinition } from '../types';

export const InvoiceProcessorInput = z.object({
  ocr_text: z
    .string()
    .min(1, 'ocr_text is required')
    .max(50_000, 'ocr_text exceeds 50k char limit'),
});
export type InvoiceProcessorInput = z.infer<typeof InvoiceProcessorInput>;

export const InvoiceProcessorOutput = z.object({
  vendor_name: z.string(),
  invoice_number: z.string(),
  invoice_date: z.string(),
  due_date: z.string(),
  amount: z.number().int().nonnegative(), // cents
  currency: z.string().length(3),
  line_items: z.array(
    z.object({
      description: z.string(),
      quantity: z.number(),
      unit_price: z.number(),
      amount: z.number(),
    })
  ),
  confidence: z.number().min(0).max(1),
  requires_review: z.boolean(),
});
export type InvoiceProcessorOutput = z.infer<typeof InvoiceProcessorOutput>;

export const invoiceProcessor: SkillDefinition<
  InvoiceProcessorInput,
  InvoiceProcessorOutput
> = {
  name: 'invoice-processor',
  description:
    'Parse an invoice OCR blob into structured fields. Use when you have OCR output and need typed invoice data.',
  inputSchema: InvoiceProcessorInput,
  outputSchema: InvoiceProcessorOutput,
  redactPII: (input) => ({ ...input, ocr_text: redact_pii(input.ocr_text) }),
  handler: async (input) => {
    const parsed = await llm.parse_invoice(input.ocr_text);
    return {
      vendor_name: parsed.vendor_name,
      invoice_number: parsed.invoice_number,
      invoice_date: parsed.invoice_date,
      due_date: parsed.due_date,
      amount: parsed.amount,
      currency: parsed.currency,
      line_items: parsed.line_items,
      confidence: parsed.confidence,
      requires_review: parsed.confidence < 0.8,
    };
  },
};
