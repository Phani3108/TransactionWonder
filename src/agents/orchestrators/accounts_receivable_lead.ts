// file: src/agents/orchestrators/accounts_receivable_lead.ts
// description: AR Lead orchestrator — dispatches to collections workers.
// reference: src/agents/orchestrators/_dispatch.ts

import { BaseAgent, type AgentConfig } from '../base';
import type { LedgerTaskStar, LedgerCapability } from '../../core/types';
import { dispatchCapability } from './_dispatch';

const AR_LEAD_CONFIG: AgentConfig = {
  id: 'accounts_receivable_lead',
  name: 'Accounts Receivable Lead',
  description: 'Customer collections orchestrator managing invoicing and payments',
  capabilities: ['invoice_parsing', 'invoice_validation', 'payment_processing'],
};

const CAPABILITY_TO_WORKER: Partial<Record<LedgerCapability, string>> = {
  invoice_parsing: 'ar_invoice_generator',
  payment_processing: 'ar_payment_recorder',
  // invoice_validation has no dedicated AR worker — handled by fallback.
};

export class AccountsReceivableLeadAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...AR_LEAD_CONFIG, ...config });
  }

  protected async execute(task: LedgerTaskStar): Promise<Record<string, unknown>> {
    this.ensure_tenant_context();
    return dispatchCapability(
      this,
      task,
      CAPABILITY_TO_WORKER,
      'You are the Accounts Receivable Lead. Focus on collections, aging, and customer payment issues.',
      'AR Lead'
    );
  }
}
