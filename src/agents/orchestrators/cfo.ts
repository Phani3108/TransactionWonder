// file: src/agents/orchestrators/cfo.ts
// description: CFO orchestrator — dispatches to strategic-finance workers.
// reference: src/agents/orchestrators/_dispatch.ts

import { BaseAgent, type AgentConfig } from '../base';
import type { LedgerTaskStar, LedgerCapability } from '../../core/types';
import { dispatchCapability } from './_dispatch';

const CFO_CONFIG: AgentConfig = {
  id: 'cfo',
  name: 'CFO',
  description: 'Strategic finance orchestrator managing planning, forecasting, and cash flow',
  capabilities: ['forecasting', 'report_analysis', 'report_generation'],
};

const CAPABILITY_TO_WORKER: Partial<Record<LedgerCapability, string>> = {
  forecasting: 'cfo_cash_flow_analyst',
  report_analysis: 'cfo_variance_analyst',
  report_generation: 'cfo_budget_manager',
};

export class CFOAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...CFO_CONFIG, ...config });
  }

  protected async execute(task: LedgerTaskStar): Promise<Record<string, unknown>> {
    this.ensure_tenant_context();
    return dispatchCapability(
      this,
      task,
      CAPABILITY_TO_WORKER,
      'You are the CFO. Answer with strategic finance and cash-flow awareness.',
      'CFO'
    );
  }
}
