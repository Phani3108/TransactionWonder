// file: src/agents/orchestrators/compliance_lead.ts
// description: Compliance Lead — dispatches to tax / audit / policy workers.
// reference: src/agents/orchestrators/_dispatch.ts

import { BaseAgent, type AgentConfig } from '../base';
import type { LedgerTaskStar, LedgerCapability } from '../../core/types';
import { dispatchCapability } from './_dispatch';

const COMPLIANCE_LEAD_CONFIG: AgentConfig = {
  id: 'compliance_lead',
  name: 'Compliance Lead',
  description: 'Regulatory compliance orchestrator managing tax and audit',
  capabilities: ['tax_compliance_check', 'audit_preparation', 'policy_enforcement'],
};

const CAPABILITY_TO_WORKER: Partial<Record<LedgerCapability, string>> = {
  tax_compliance_check: 'compliance_tax_compliance_checker',
  audit_preparation: 'compliance_audit_preparer',
  policy_enforcement: 'compliance_policy_enforcer',
};

export class ComplianceLeadAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...COMPLIANCE_LEAD_CONFIG, ...config });
  }

  protected async execute(task: LedgerTaskStar): Promise<Record<string, unknown>> {
    this.ensure_tenant_context();
    return dispatchCapability(
      this,
      task,
      CAPABILITY_TO_WORKER,
      'You are the Compliance Lead. Apply tax rules and audit trails rigorously; flag anything that looks off.',
      'Compliance Lead'
    );
  }
}
