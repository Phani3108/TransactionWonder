// file: src/agents/orchestrators/reconciliation_lead.ts
// description: Reconciliation Lead — dispatches to matching / discrepancy workers.
// reference: src/agents/orchestrators/_dispatch.ts

import { BaseAgent, type AgentConfig } from '../base';
import type { LedgerTaskStar, LedgerCapability } from '../../core/types';
import { dispatchCapability } from './_dispatch';

const RECONCILIATION_LEAD_CONFIG: AgentConfig = {
  id: 'reconciliation_lead',
  name: 'Reconciliation Lead',
  description: 'Bank matching orchestrator managing transaction reconciliation',
  capabilities: ['transaction_matching', 'discrepancy_detection', 'discrepancy_resolution'],
};

const CAPABILITY_TO_WORKER: Partial<Record<LedgerCapability, string>> = {
  transaction_matching: 'reconciliation_transaction_matcher',
  discrepancy_detection: 'reconciliation_discrepancy_detector',
  discrepancy_resolution: 'reconciliation_discrepancy_investigator',
};

export class ReconciliationLeadAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...RECONCILIATION_LEAD_CONFIG, ...config });
  }

  protected async execute(task: LedgerTaskStar): Promise<Record<string, unknown>> {
    this.ensure_tenant_context();
    return dispatchCapability(
      this,
      task,
      CAPABILITY_TO_WORKER,
      'You are the Reconciliation Lead. Match transactions precisely and surface any discrepancy with evidence.',
      'Reconciliation Lead'
    );
  }
}
