// file: src/skills/handlers/data-sync.ts
// description: data-sync skill — bidirectional sync stub for QuickBooks/Xero.
//              The full flow needs the token manager from P1-2 to persist
//              and refresh OAuth tokens; until that's live this skill
//              reports its inputs and the token-availability state so
//              callers can fail gracefully.
// reference: src/integrations/quickbooks/client.ts, src/integrations/xero/client.ts

import { z } from 'zod';
import type { SkillDefinition } from '../types';

export const DataSyncInput = z.object({
  provider: z.enum(['quickbooks', 'xero']),
  direction: z.enum(['import', 'export', 'bidirectional']),
  since: z.string().optional(), // ISO timestamp
});
export type DataSyncInput = z.infer<typeof DataSyncInput>;

export const DataSyncOutput = z.object({
  provider: z.string(),
  direction: z.string(),
  status: z.enum(['ok', 'no_token', 'synthetic', 'failed']),
  imported: z.number().int().nonnegative(),
  exported: z.number().int().nonnegative(),
  since: z.string().nullable(),
  note: z.string().optional(),
});
export type DataSyncOutput = z.infer<typeof DataSyncOutput>;

export const dataSync: SkillDefinition<DataSyncInput, DataSyncOutput> = {
  name: 'data-sync',
  description: 'Bidirectional sync with QuickBooks or Xero. Requires persisted OAuth tokens (P1-2).',
  inputSchema: DataSyncInput,
  outputSchema: DataSyncOutput,
  handler: async (input) => {
    const hasCreds =
      input.provider === 'quickbooks'
        ? Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET)
        : Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);

    if (!hasCreds) {
      return {
        provider: input.provider,
        direction: input.direction,
        status: 'synthetic' as const,
        imported: 0,
        exported: 0,
        since: input.since ?? null,
        note: `No ${input.provider.toUpperCase()}_CLIENT_ID/SECRET set; running in synthetic mode.`,
      };
    }

    // Token persistence is P1-2. Without it, we can't call the external
    // system with a valid refreshed token from here. Return a clear
    // "no_token" status so the caller can trigger the OAuth flow.
    return {
      provider: input.provider,
      direction: input.direction,
      status: 'no_token' as const,
      imported: 0,
      exported: 0,
      since: input.since ?? null,
      note: 'Token manager not yet implemented (P1-2). Complete OAuth + persistence to enable live sync.',
    };
  },
};
