// file: src/skills/executor.ts
// description: The single entry point for invoking a skill.
//              - Validates input via Zod
//              - Redacts PII (when the skill opts in)
//              - Runs the handler with the provided context
//              - Validates output via Zod
//              - Attaches audit breadcrumbs to stdout (DB audit comes in P1-8)
// reference: src/skills/registry.ts, src/skills/types.ts

import { ZodError } from 'zod';
import {
  SkillInputError,
  SkillNotFoundError,
  SkillOutputError,
  type SkillContext,
} from './types';
import { getSkill } from './registry';

/**
 * Invoke a registered skill by name.
 *
 * Throws:
 *   - SkillNotFoundError if no skill has that name
 *   - SkillInputError    if the input fails `skill.inputSchema`
 *   - SkillOutputError   if the handler returns something that fails `skill.outputSchema`
 *   - any error the handler itself throws (e.g., Stripe / LLM / DB errors)
 *
 * The wrapped handler is the right place to add cross-cutting concerns
 * (retry, circuit breaker, audit-log INSERT). Those are added in P1-1
 * (HTTP wrapper) and P1-8 (audit log persistence).
 */
export async function invokeSkill<Out extends Record<string, unknown> = Record<string, unknown>>(
  name: string,
  input: unknown,
  ctx: SkillContext
): Promise<Out> {
  const skill = getSkill(name);
  if (!skill) throw new SkillNotFoundError(name);

  // Validate input
  let validatedInput: Record<string, unknown>;
  try {
    validatedInput = skill.inputSchema.parse(input);
  } catch (err) {
    throw new SkillInputError(name, err instanceof ZodError ? err.flatten() : err);
  }

  // Optional PII redaction pass (for skills that send user text to an LLM)
  const handlerInput = skill.redactPII ? skill.redactPII(validatedInput) : validatedInput;

  const started = Date.now();
  console.log(`[skill:${name}] start tenant=${ctx.tenant_id}`);

  const rawOutput = await skill.handler(handlerInput, ctx);

  // Validate output
  let validatedOutput: Record<string, unknown>;
  try {
    validatedOutput = skill.outputSchema.parse(rawOutput);
  } catch (err) {
    throw new SkillOutputError(name, err instanceof ZodError ? err.flatten() : err);
  }

  const duration_ms = Date.now() - started;
  console.log(`[skill:${name}] ok (${duration_ms}ms)`);

  return validatedOutput as Out;
}
