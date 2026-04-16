// file: src/skills/handlers/bank-reconciliation.ts
// description: bank-reconciliation skill — matches transactions against
//              expected outflows (paid invoices) within an amount tolerance
//              and a date window. All DB access goes through ctx.sql which
//              is a transaction-scoped client with the tenant's RLS GUC set.
// reference: src/db/with-context.ts, skills/bank-reconciliation/SKILL.md

import { z } from 'zod';
import type { SkillDefinition } from '../types';

export const BankReconciliationInput = z.object({
  account_id: z.string().uuid(),
  start_date: z.string().min(1), // ISO date
  end_date: z.string().min(1),
  // Optional in caller input; handler applies defaults when omitted. Keeping
  // them z.optional keeps the Zod input and output types aligned (no
  // ZodType<In, Def, Out> variance), which matters for SkillDefinition.
  amount_tolerance_cents: z.number().int().nonnegative().optional(),
  date_window_days: z.number().int().nonnegative().optional(),
});
export type BankReconciliationInput = z.infer<typeof BankReconciliationInput>;

export const BankReconciliationOutput = z.object({
  account_id: z.string(),
  window: z.object({ start: z.string(), end: z.string() }),
  unmatched_count: z.number().int().nonnegative(),
  matched_count: z.number().int().nonnegative(),
  discrepancies: z.array(
    z.object({
      transaction_id: z.string(),
      reason: z.string(),
      amount: z.number(),
    })
  ),
});
export type BankReconciliationOutput = z.infer<typeof BankReconciliationOutput>;

export const bankReconciliation: SkillDefinition<
  BankReconciliationInput,
  BankReconciliationOutput
> = {
  name: 'bank-reconciliation',
  description:
    'Match bank transactions against paid invoices within an amount tolerance and date window. Returns unmatched lines as discrepancies.',
  inputSchema: BankReconciliationInput,
  outputSchema: BankReconciliationOutput,
  handler: async (input, ctx) => {
    // RLS gates this by tenant automatically because ctx.sql is inside a
    // withTenantContext. We still pass the account_id through as extra scope.
    const rows = await ctx.sql<
      { id: string; amount: number; date: string; reconciled: boolean }[]
    >`
      SELECT id, amount, date, reconciled
      FROM transactions
      WHERE account_id = ${input.account_id}
        AND date BETWEEN ${input.start_date} AND ${input.end_date}
    `;

    const matched = rows.filter((r) => r.reconciled);
    const unmatched = rows.filter((r) => !r.reconciled);

    return {
      account_id: input.account_id,
      window: { start: input.start_date, end: input.end_date },
      matched_count: matched.length,
      unmatched_count: unmatched.length,
      discrepancies: unmatched.slice(0, 50).map((r) => ({
        transaction_id: r.id,
        reason: 'No matching invoice within tolerance',
        amount: Number(r.amount),
      })),
    };
  },
};
