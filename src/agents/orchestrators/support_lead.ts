// file: src/agents/orchestrators/support_lead.ts
// description: Support Lead — dispatches to help-desk / diagnostics / escalation workers.
// reference: src/agents/orchestrators/_dispatch.ts

import { BaseAgent, type AgentConfig } from '../base';
import type { LedgerTaskStar, LedgerCapability } from '../../core/types';
import { dispatchCapability } from './_dispatch';

const SUPPORT_LEAD_CONFIG: AgentConfig = {
  id: 'support_lead',
  name: 'Support Lead',
  description: 'User assistance orchestrator managing help desk and error recovery',
  capabilities: ['user_assistance', 'error_recovery', 'escalation_handling'],
};

const CAPABILITY_TO_WORKER: Partial<Record<LedgerCapability, string>> = {
  user_assistance: 'support_help_desk_agent',
  error_recovery: 'support_error_diagnostician',
  escalation_handling: 'support_escalation_manager',
};

export class SupportLeadAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...SUPPORT_LEAD_CONFIG, ...config });
  }

  protected async execute(task: LedgerTaskStar): Promise<Record<string, unknown>> {
    this.ensure_tenant_context();
    return dispatchCapability(
      this,
      task,
      CAPABILITY_TO_WORKER,
      'You are the Support Lead. Resolve user issues clearly; escalate with context rather than ping-ponging.',
      'Support Lead'
    );
  }
}
