// file: src/agents/orchestrators/accounts_payable_lead.ts
// description: Accounts Payable Lead orchestrator — dispatches to AP workers.
// reference: src/agents/orchestrators/_dispatch.ts

import { BaseAgent, type AgentConfig } from '../base';
import type { LedgerTaskStar, LedgerCapability } from '../../core/types';
import { dispatchCapability } from './_dispatch';

const AP_LEAD_CONFIG: AgentConfig = {
  id: 'accounts_payable_lead',
  name: 'Accounts Payable Lead',
  description: 'Vendor payment orchestrator managing invoice processing and payments',
  capabilities: [
    'invoice_parsing',
    'invoice_validation',
    'invoice_categorization',
    'invoice_approval',
    'payment_processing',
  ],
};

const CAPABILITY_TO_WORKER: Partial<Record<LedgerCapability, string>> = {
  invoice_parsing: 'ap_invoice_parser',
  invoice_validation: 'ap_invoice_validator',
  invoice_categorization: 'ap_expense_categorizer',
  invoice_approval: 'ap_approval_router',
  payment_processing: 'ap_payment_processor',
};

export class AccountsPayableLeadAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...AP_LEAD_CONFIG, ...config });
  }

  protected async execute(task: LedgerTaskStar): Promise<Record<string, unknown>> {
    this.ensure_tenant_context();
    return dispatchCapability(
      this,
      task,
      CAPABILITY_TO_WORKER,
      'You are the Accounts Payable Lead. Answer clearly, using invoice-processing best practices.',
      'AP Lead'
    );
  }
}
