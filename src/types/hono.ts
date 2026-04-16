// file: src/types/hono.ts
// description: Hono type definitions for ClawKeeper API context
// reference: src/api/server.ts, src/db/with-context.ts

import type { Context } from 'hono';
import type { Sql } from 'postgres';

/**
 * Custom variables stored in Hono context.
 */
export interface AppVariables {
  tenant_id: string;
  user_id: string;
  user_role: string;

  /**
   * Request-scoped SQL client.
   *
   * - For authenticated routes: a transaction opened by the tenant-context
   *   middleware with RLS session variables set LOCAL to that transaction.
   * - For public routes (login, health, agents/status): the base pool
   *   client (no tenant context).
   *
   * **Always prefer `c.var.sql` over the module-scoped `sql` client inside
   * route handlers.** Only this client has the per-request tenant context
   * applied; queries run through the module-scoped client will either miss
   * RLS (when policies allow it) or return empty rows (when they don't) —
   * either way, it's wrong.
   */
  sql: Sql<Record<string, unknown>>;
}

/**
 * Environment bindings for Hono app.
 */
export interface AppEnv {
  Variables: AppVariables;
}

/**
 * Typed context for route handlers.
 */
export type AppContext = Context<AppEnv>;
