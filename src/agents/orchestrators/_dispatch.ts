// file: src/agents/orchestrators/_dispatch.ts
// description: Shared capability → worker dispatch helper used by every
//              orchestrator in this directory. Keeps the 9 orchestrator
//              files tiny and the pattern uniform.
// reference: src/agents/orchestrators/accounts_payable_lead.ts (reference impl)

import type { BaseAgent } from '../base';
import type { LedgerTaskStar, LedgerCapability, LedgerAgentId } from '../../core/types';
import * as llm from '../../core/llm-client';

/**
 * Look at task.required_capabilities, find the first one with a
 * registered worker in `table`, and delegate to that worker via
 * agent_runtime. If nothing matches, fall back to a local LLM call
 * tailored to the orchestrator's role via `fallbackSystemPrompt`.
 *
 * The orchestrator passes `self` so `ensure_tenant_context()` picks up
 * the right tenant scope (BaseAgent stores it per-invocation).
 */
export async function dispatchCapability(
  self: BaseAgent,
  task: LedgerTaskStar,
  table: Partial<Record<LedgerCapability, string>>,
  fallbackSystemPrompt: string,
  orchestratorLabel: string
): Promise<Record<string, unknown>> {
  const tenant = ensureTenantContext(self);

  for (const cap of task.required_capabilities) {
    const worker_id = table[cap];
    if (!worker_id) continue;

    console.log(`[${orchestratorLabel}] → worker ${worker_id} (capability: ${cap})`);

    // Lazy-import to dodge the index.ts ↔ orchestrator module cycle.
    const { agent_runtime } = await import('../index');
    const worker = await agent_runtime.get_agent(worker_id);
    const result = await worker.execute_task(
      {
        ...task,
        assigned_agent: worker_id as LedgerAgentId,
        required_capabilities: [cap],
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
      capability: cap,
      task_id: task.id,
      duration_ms: result.duration_ms,
      output: result.output,
    };
  }

  // Nothing matched — LLM fallback (still gated by the llm client's
  // circuit breaker, retry, and PII redaction layers).
  const request = String(task.input?.request ?? task.description ?? '');
  const response = await llm.complete(request, {
    system: fallbackSystemPrompt,
    temperature: 0.3,
  });
  return {
    handled_by: `${orchestratorLabel.toLowerCase().replace(/\s+/g, '_')}_fallback`,
    response,
    task_id: task.id,
  };
}

// BaseAgent#ensure_tenant_context is protected. We mirror it here with a
// narrow cast so the helper can reach it without loosening BaseAgent's API.
function ensureTenantContext(self: BaseAgent): {
  tenant_id: string;
  user_id: string;
  user_role: string;
} {
  const fn = (self as unknown as { ensure_tenant_context: () => unknown }).ensure_tenant_context;
  return fn.call(self) as { tenant_id: string; user_id: string; user_role: string };
}
