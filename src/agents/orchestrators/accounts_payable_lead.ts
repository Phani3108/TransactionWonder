// file: src/agents/orchestrators/accounts_payable_lead.ts
// description: Accounts Payable Lead orchestrator — dispatches to AP workers.
// reference: src/agents/base.ts, src/agents/worker_registry.ts

import { BaseAgent, type AgentConfig } from '../base';
import type { LedgerTaskStar, LedgerCapability } from '../../core/types';
import * as llm from '../../core/llm-client';

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

// Capability → worker id dispatch table. See src/agents/worker_registry.ts for
// the full worker inventory. When P1-5 fills in real worker behavior, the
// orchestrator keeps dispatching through this table unchanged.
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
    const { name, required_capabilities } = task;
    this.ensure_tenant_context();

    console.log(`[AP Lead] Processing: ${name}`);

    // Dispatch the task to the first capable worker. This is the reference
    // implementation for the orchestrator → worker hierarchy; the other 8
    // orchestrators follow the same pattern in P1-5.
    for (const cap of required_capabilities) {
      const worker_id = CAPABILITY_TO_WORKER[cap];
      if (worker_id) {
        return await this.dispatch_to_worker(worker_id, cap, task);
      }
    }

    // No worker matched: fall back to local LLM handling so the user still
    // gets a response. This path is exercised for capabilities the AP Lead
    // doesn't yet own a worker for.
    return await this.fallback_local(task);
  }

  private async dispatch_to_worker(
    worker_id: string,
    capability: LedgerCapability,
    task: LedgerTaskStar
  ): Promise<Record<string, unknown>> {
    console.log(`[AP Lead] → worker ${worker_id} (capability: ${capability})`);

    // Lazy-import the runtime to avoid the index.ts import cycle.
    const { agent_runtime } = await import('../index');

    const tenant = this.ensure_tenant_context();
    const worker = await agent_runtime.get_agent(worker_id);
    const result = await worker.execute_task(
      {
        ...task,
        assigned_agent: worker_id as LedgerTaskStar['assigned_agent'],
        required_capabilities: [capability],
      },
      tenant
    );

    if (!result.success) {
      throw new Error(
        `Worker ${worker_id} failed task ${task.id}: ${result.error ?? 'unknown error'}`
      );
    }

    return {
      dispatched_to: worker_id,
      capability,
      task_id: task.id,
      duration_ms: result.duration_ms,
      output: result.output,
    };
  }

  private async fallback_local(task: LedgerTaskStar): Promise<Record<string, unknown>> {
    const request = String(task.input?.request ?? task.description ?? '');
    const response = await llm.complete(request, {
      system:
        'You are the Accounts Payable Lead. Answer clearly, using invoice-processing best practices.',
      temperature: 0.3,
    });
    return { handled_by: 'ap_lead_fallback', response, task_id: task.id };
  }
}
