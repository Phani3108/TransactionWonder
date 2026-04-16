// file: src/agents/orchestrators/reporting_lead.ts
// description: Reporting Lead — dispatches to P&L / balance-sheet / analysis workers.
// reference: src/agents/orchestrators/_dispatch.ts

import { BaseAgent, type AgentConfig } from '../base';
import type { LedgerTaskStar, LedgerCapability } from '../../core/types';
import { dispatchCapability } from './_dispatch';

const REPORTING_LEAD_CONFIG: AgentConfig = {
  id: 'reporting_lead',
  name: 'Reporting Lead',
  description: 'Financial reports orchestrator managing P&L, balance sheet, and custom reports',
  capabilities: ['report_generation', 'report_analysis'],
};

const CAPABILITY_TO_WORKER: Partial<Record<LedgerCapability, string>> = {
  report_generation: 'reporting_pl_generator',
  report_analysis: 'reporting_comparative_analyzer',
};

export class ReportingLeadAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...REPORTING_LEAD_CONFIG, ...config });
  }

  protected async execute(task: LedgerTaskStar): Promise<Record<string, unknown>> {
    this.ensure_tenant_context();
    return dispatchCapability(
      this,
      task,
      CAPABILITY_TO_WORKER,
      'You are the Reporting Lead. Produce accurate financial reports and call out meaningful trends.',
      'Reporting Lead'
    );
  }
}
