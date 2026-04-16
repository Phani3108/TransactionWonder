// file: src/skills/types.ts
// description: Skill contract — every skill is a (input schema, output schema, handler)
//              triple invoked through src/skills/executor.ts.
// reference: src/skills/executor.ts, src/skills/registry.ts

import type { z } from 'zod';
import type { Sql } from 'postgres';

/**
 * Per-invocation context supplied by the caller (usually a worker agent or
 * route handler). Skills must use `ctx.sql` for any DB access so the
 * transaction-scoped RLS GUCs apply (see src/db/with-context.ts).
 */
export interface SkillContext {
  tenant_id: string;
  user_id: string;
  role: string;
  /** Transaction-scoped SQL client. Required for tenant-scoped queries. */
  sql: Sql<Record<string, unknown>>;
}

/**
 * A registered skill.
 *
 * - `inputSchema` validates the call arguments (runs before `handler`).
 * - `outputSchema` validates the handler's return value (runs after).
 * - `redactPII` is a hook for skills that send untrusted text to an LLM;
 *   it's invoked on the already-validated input before handing it off.
 */
export interface SkillDefinition<
  In extends Record<string, unknown> = Record<string, unknown>,
  Out extends Record<string, unknown> = Record<string, unknown>,
> {
  name: string;
  description: string;
  inputSchema: z.ZodType<In>;
  outputSchema: z.ZodType<Out>;
  handler: (input: In, ctx: SkillContext) => Promise<Out>;
  redactPII?: (input: In) => In;
}

/** Thrown when a skill name is not registered. */
export class SkillNotFoundError extends Error {
  constructor(name: string) {
    super(`No skill registered with name: ${name}`);
    this.name = 'SkillNotFoundError';
  }
}

/** Thrown when input fails schema validation. */
export class SkillInputError extends Error {
  constructor(name: string, cause: unknown) {
    super(`Invalid input for skill ${name}: ${String(cause)}`);
    this.name = 'SkillInputError';
    (this as unknown as { cause: unknown }).cause = cause;
  }
}

/** Thrown when handler output fails schema validation. */
export class SkillOutputError extends Error {
  constructor(name: string, cause: unknown) {
    super(`Invalid output from skill ${name}: ${String(cause)}`);
    this.name = 'SkillOutputError';
    (this as unknown as { cause: unknown }).cause = cause;
  }
}
