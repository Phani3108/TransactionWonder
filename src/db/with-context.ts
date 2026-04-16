// file: src/db/with-context.ts
// description: Per-request tenant context wrapper. Opens a transaction and
//              sets PostgreSQL RLS session variables via parameterized
//              set_config() calls, so tenant context is transaction-scoped
//              (no connection-pool bleed) and no JWT-derived value is
//              interpolated into raw SQL.
// reference: db/rls.sql, src/api/server.ts

import type { Sql } from 'postgres';

export interface TenantContext {
  tenant_id: string;
  user_id: string;
  role: string;
}

/**
 * Run `fn` inside a transaction that has RLS session variables set LOCAL
 * to the transaction.
 *
 * This replaces the previous pattern in server.ts:
 *
 *   await sql.unsafe(`SET app.current_tenant_id = '${decoded.tenant_id}'`);
 *
 * which had two defects:
 *
 * 1. **Cross-tenant GUC bleed via connection pool.** Plain `SET` is
 *    session-scoped. With `max: 10` connections in the pool, one request's
 *    tenant context could persist on the connection and be observed by the
 *    next request that reused it — breaking tenant isolation. `set_config`
 *    with `is_local = true` is transaction-scoped and is discarded on
 *    COMMIT/ROLLBACK.
 *
 * 2. **SQL injection via SET.** String-interpolating a JWT-derived value
 *    into `sql.unsafe(...)` was mitigated only by the JWT signature; if
 *    `JWT_SECRET` ever leaked, the path was trivially exploitable.
 *    `set_config(name, value, local)` accepts the value as a parameter via
 *    tagged template, so there is no interpolation.
 *
 * The callback receives the transaction-scoped SQL client. Queries run on
 * the outer client (e.g., the module-scoped `sql` in server.ts) will NOT
 * see the LOCAL GUCs — every query inside a request must use the client
 * passed to the callback, or the client stored on the Hono context
 * (`c.var.sql`) which is set by the tenant-context middleware.
 */
export async function withTenantContext<T>(
  sql: Sql<Record<string, unknown>>,
  ctx: TenantContext,
  fn: (tx: Sql<Record<string, unknown>>) => Promise<T>
): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_tenant_id', ${ctx.tenant_id}, true)`;
    await tx`SELECT set_config('app.current_user_id', ${ctx.user_id}, true)`;
    await tx`SELECT set_config('app.current_user_role', ${ctx.role}, true)`;
    return fn(tx as unknown as Sql<Record<string, unknown>>);
  })) as T;
}
