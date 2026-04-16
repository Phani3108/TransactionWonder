// file: src/agents/orchestrators/integration_lead.ts
// description: Integration Lead — dispatches to Plaid / Stripe / QB / Xero workers.
// reference: src/agents/orchestrators/_dispatch.ts

import { BaseAgent, type AgentConfig } from '../base';
import type { LedgerTaskStar, LedgerCapability } from '../../core/types';
import { dispatchCapability } from './_dispatch';

const INTEGRATION_LEAD_CONFIG: AgentConfig = {
  id: 'integration_lead',
  name: 'Integration Lead',
  description: 'External systems orchestrator managing Plaid, Stripe, QuickBooks, Xero',
  capabilities: ['bank_sync', 'accounting_sync', 'payment_gateway_integration'],
};

const CAPABILITY_TO_WORKER: Partial<Record<LedgerCapability, string>> = {
  bank_sync: 'integration_plaid_connector',
  accounting_sync: 'integration_quickbooks_syncer',
  payment_gateway_integration: 'integration_stripe_integrator',
};

export class IntegrationLeadAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...INTEGRATION_LEAD_CONFIG, ...config });
  }

  protected async execute(task: LedgerTaskStar): Promise<Record<string, unknown>> {
    this.ensure_tenant_context();
    return dispatchCapability(
      this,
      task,
      CAPABILITY_TO_WORKER,
      'You are the Integration Lead. Keep external systems in sync and report any connection issues.',
      'Integration Lead'
    );
  }
}
