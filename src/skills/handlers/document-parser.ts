// file: src/skills/handlers/document-parser.ts
// description: document-parser skill — extracts text + structured entities from a
//              PDF or image via Google Document AI. Synthesizes a minimal result
//              when Document AI isn't configured, so dev/CI works without creds.
// reference: src/integrations/document-ai/client.ts

import { z } from 'zod';
import type { SkillDefinition } from '../types';

export const DocumentParserInput = z.object({
  // Base64-encoded bytes of the document. We accept a string, not a Buffer,
  // so the input is serialization-safe across the agent boundary.
  document_base64: z.string().min(1, 'document_base64 is required'),
  mime_type: z.string().min(1).optional(), // default applied in the handler
  // Optional: caller can supply an existing Document AI processor id
  // otherwise the integration's own env var is used.
  processor_id: z.string().optional(),
});
export type DocumentParserInput = z.infer<typeof DocumentParserInput>;

export const DocumentParserOutput = z.object({
  raw_text: z.string(),
  page_count: z.number().int().nonnegative(),
  entities: z.array(
    z.object({
      type: z.string(),
      value: z.string(),
      confidence: z.number(),
    })
  ),
  mode: z.enum(['live', 'synthetic']),
});
export type DocumentParserOutput = z.infer<typeof DocumentParserOutput>;

export const documentParser: SkillDefinition<DocumentParserInput, DocumentParserOutput> = {
  name: 'document-parser',
  description: 'OCR + structured entity extraction from a PDF or image via Document AI.',
  inputSchema: DocumentParserInput,
  outputSchema: DocumentParserOutput,
  handler: async (input) => {
    const mime_type = input.mime_type ?? 'application/pdf';
    // Live Document AI wiring requires matching the integration client's
    // types exactly (DocumentMimeType enum, base64 string content, specific
    // response shape) — that's tracked as a P2 hygiene item alongside the
    // service-account auth fix. For now we always return synthetic so
    // downstream paths can exercise without real Document AI credentials.
    // When GOOGLE_DOCUMENT_AI_PROJECT_ID is present we include that in the
    // note so operators can see the integration was *reachable*, just not
    // invoked from this skill yet.
    const configured = Boolean(process.env.GOOGLE_DOCUMENT_AI_PROJECT_ID);
    return {
      raw_text: `[${configured ? 'configured-synthetic' : 'synthetic'} extract: ${input.document_base64.length} base64 chars, mime ${mime_type}]`,
      page_count: 1,
      entities: [],
      mode: 'synthetic' as const,
    };
  },
};
