// file: src/skills/handlers/financial-reporting.ts
// description: financial-reporting skill — runs canonical P&L / cash-flow SQL
//              through the tenant-scoped sql client. RLS keeps numbers
//              segregated per tenant automatically.
// reference: skills/financial-reporting/SKILL.md

import { z } from 'zod';
import type { SkillDefinition } from '../types';

export const FinancialReportingInput = z.object({
  report_type: z.enum(['profit_loss', 'cash_flow', 'balance_sheet']),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
});
export type FinancialReportingInput = z.infer<typeof FinancialReportingInput>;

export const FinancialReportingOutput = z.object({
  report_type: z.string(),
  period: z.object({ start: z.string(), end: z.string() }),
  totals: z.record(z.number()),
  breakdown: z.array(z.object({ label: z.string(), amount: z.number() })),
});
export type FinancialReportingOutput = z.infer<typeof FinancialReportingOutput>;

export const financialReporting: SkillDefinition<
  FinancialReportingInput,
  FinancialReportingOutput
> = {
  name: 'financial-reporting',
  description: 'Generate P&L, cash flow, or balance sheet for a period. Tenant-scoped via RLS.',
  inputSchema: FinancialReportingInput,
  outputSchema: FinancialReportingOutput,
  handler: async (input, ctx) => {
    if (input.report_type === 'profit_loss') {
      const [revenueRow] = await ctx.sql<{ total: number }[]>`
        SELECT COALESCE(SUM(amount), 0)::bigint AS total
        FROM transactions
        WHERE date BETWEEN ${input.start_date} AND ${input.end_date}
          AND category = 'income'
      `;
      const expensesByCat = await ctx.sql<{ subcategory: string; total: number }[]>`
        SELECT subcategory, COALESCE(SUM(ABS(amount)), 0)::bigint AS total
        FROM transactions
        WHERE date BETWEEN ${input.start_date} AND ${input.end_date}
          AND category = 'expense'
        GROUP BY subcategory
        ORDER BY total DESC
      `;
      const revenue = Number(revenueRow?.total ?? 0);
      const total_expenses = expensesByCat.reduce((s, e) => s + Number(e.total), 0);
      return {
        report_type: 'profit_loss',
        period: { start: input.start_date, end: input.end_date },
        totals: { revenue, expenses: total_expenses, net_income: revenue - total_expenses },
        breakdown: expensesByCat.map((e) => ({
          label: e.subcategory ?? 'uncategorized',
          amount: Number(e.total),
        })),
      };
    }

    if (input.report_type === 'cash_flow') {
      const rows = await ctx.sql<{ inflow: number; outflow: number }[]>`
        SELECT
          COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)::bigint AS inflow,
          COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)::bigint AS outflow
        FROM transactions
        WHERE date BETWEEN ${input.start_date} AND ${input.end_date}
      `;
      const r = rows[0] ?? { inflow: 0, outflow: 0 };
      return {
        report_type: 'cash_flow',
        period: { start: input.start_date, end: input.end_date },
        totals: { inflow: Number(r.inflow), outflow: Number(r.outflow), net: Number(r.inflow) - Number(r.outflow) },
        breakdown: [],
      };
    }

    // balance_sheet
    const rows = await ctx.sql<{ type: string; total: number }[]>`
      SELECT type, COALESCE(SUM(balance), 0)::bigint AS total
      FROM accounts
      GROUP BY type
    `;
    const totals: Record<string, number> = {};
    for (const r of rows) totals[r.type] = Number(r.total);
    return {
      report_type: 'balance_sheet',
      period: { start: input.start_date, end: input.end_date },
      totals,
      breakdown: rows.map((r) => ({ label: r.type, amount: Number(r.total) })),
    };
  },
};
