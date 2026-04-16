// file: src/skills/handlers/audit-trail.ts
// description: audit-trail skill — writes a row into audit_log with the
//              tenant-scoped client. The RLS policy on audit_log enforces
//              that tenant_id matches the current GUC, so callers can't
//              forge cross-tenant audit entries even through this skill.
// reference: db/schema.sql (audit_log), src/db/with-context.ts

import { z } from 'zod';
import type { SkillDefinition } from '../types';

const AuditAction = z.enum([
  'create',
  'update',
  'delete',
  'approve',
  'reject',
  'export',
  'import',
]);

export const AuditTrailInput = z.object({
  action: AuditAction,
  entity_type: z.string().min(1).max(100),
  entity_id: z.string().uuid(),
  changes: z.record(z.unknown()).optional(),
  ip_address: z.string().optional(),
  user_agent: z.string().optional(),
});
export type AuditTrailInput = z.infer<typeof AuditTrailInput>;

export const AuditTrailOutput = z.object({
  audit_id: z.string().uuid(),
  written_at: z.string(),
});
export type AuditTrailOutput = z.infer<typeof AuditTrailOutput>;

export const auditTrail: SkillDefinition<AuditTrailInput, AuditTrailOutput> = {
  name: 'audit-trail',
  description: 'Write an immutable audit_log entry for a financial action.',
  inputSchema: AuditTrailInput,
  outputSchema: AuditTrailOutput,
  handler: async (input, ctx) => {
    const changes = input.changes ? JSON.stringify(input.changes) : null;
    const [row] = await ctx.sql<{ id: string; timestamp: string }[]>`
      INSERT INTO audit_log
        (tenant_id, user_id, action, entity_type, entity_id, changes, ip_address, user_agent)
      VALUES
        (${ctx.tenant_id},
         ${ctx.user_id},
         ${input.action},
         ${input.entity_type},
         ${input.entity_id},
         ${changes}::jsonb,
         ${input.ip_address ?? null}::inet,
         ${input.user_agent ?? null})
      RETURNING id, timestamp
    `;
    return { audit_id: row.id, written_at: String(row.timestamp) };
  },
};
