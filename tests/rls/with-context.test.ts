// file: tests/rls/with-context.test.ts
// description: Integration tests for src/db/with-context.ts. Proves that the
//              transaction-scoped RLS session variables fix both the
//              connection-pool GUC bleed and the SET-command injection path
//              that previously existed in src/api/server.ts.
//
// Run with: DATABASE_URL=postgres://... bun test tests/rls
//
// The tests require a reachable Postgres instance. If DATABASE_URL is not
// set, the suite self-skips rather than failing so the main test matrix can
// run without a DB dependency.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres, { type Sql } from 'postgres';
import { withTenantContext } from '../../src/db/with-context';

const DATABASE_URL = process.env.DATABASE_URL;
const runIntegration = Boolean(DATABASE_URL);
const itIntegration = runIntegration ? test : test.skip;

describe('withTenantContext — RLS plumbing', () => {
  let sql: Sql<Record<string, unknown>>;

  beforeAll(() => {
    if (!runIntegration) return;
    // Deliberately tiny pool to force connection reuse across tests —
    // this is what the pool-bleed bug used to rely on.
    sql = postgres(DATABASE_URL!, { max: 2, idle_timeout: 1 });
  });

  afterAll(async () => {
    if (!runIntegration) return;
    await sql.end({ timeout: 1 });
  });

  itIntegration(
    'sets all three RLS session variables inside the transaction',
    async () => {
      const row = await withTenantContext(
        sql,
        { tenant_id: 'tenant-a', user_id: 'user-a', role: 'accountant' },
        async (tx) => {
          const [r] = await tx`
            SELECT
              current_setting('app.current_tenant_id', true) AS tid,
              current_setting('app.current_user_id',   true) AS uid,
              current_setting('app.current_user_role', true) AS role
          `;
          return r;
        }
      );

      expect(row.tid).toBe('tenant-a');
      expect(row.uid).toBe('user-a');
      expect(row.role).toBe('accountant');
    }
  );

  itIntegration(
    'does NOT leak context to the outer pool connection after commit (pool-bleed fix)',
    async () => {
      await withTenantContext(
        sql,
        { tenant_id: 'tenant-leaky', user_id: 'u', role: 'viewer' },
        async (tx) => {
          const [inside] = await tx`
            SELECT current_setting('app.current_tenant_id', true) AS tid
          `;
          expect(inside.tid).toBe('tenant-leaky');
        }
      );

      // Same sql client, but OUTSIDE the transaction. If we had used session-level
      // `SET` (the old bug), this connection could still carry 'tenant-leaky'.
      // `set_config(..., true)` discards the value on COMMIT/ROLLBACK.
      const [after] = await sql`
        SELECT current_setting('app.current_tenant_id', true) AS tid
      `;
      expect(after.tid ?? '').toBe('');
    }
  );

  itIntegration(
    'keeps concurrent tenants isolated on a 2-connection pool',
    async () => {
      const runAs = (tenant: string) =>
        withTenantContext(
          sql,
          { tenant_id: tenant, user_id: 'u', role: 'accountant' },
          async (tx) => {
            // Yield so both transactions have a chance to interleave under the tiny pool.
            await new Promise((r) => setTimeout(r, 10));
            const [row] = await tx`
              SELECT current_setting('app.current_tenant_id', true) AS tid
            `;
            return row.tid as string;
          }
        );

      const [a, b, c, d] = await Promise.all([
        runAs('tenant-1'),
        runAs('tenant-2'),
        runAs('tenant-3'),
        runAs('tenant-4'),
      ]);

      expect(a).toBe('tenant-1');
      expect(b).toBe('tenant-2');
      expect(c).toBe('tenant-3');
      expect(d).toBe('tenant-4');
    }
  );

  itIntegration(
    'treats single-quote payloads as data, not SQL (SET-injection fix)',
    async () => {
      // In the old code path this literal would have been string-interpolated
      // into `SET app.current_tenant_id = '...'`, breaking out of the quoted
      // value. With set_config() + tagged-template parameters, the whole
      // payload is stored verbatim as the GUC value.
      const evil = "'; DROP TABLE pg_catalog.pg_class; --";

      const stored = await withTenantContext(
        sql,
        { tenant_id: evil, user_id: 'u', role: 'viewer' },
        async (tx) => {
          const [r] = await tx`
            SELECT current_setting('app.current_tenant_id', true) AS tid
          `;
          return r.tid as string;
        }
      );

      expect(stored).toBe(evil);
    }
  );

  itIntegration(
    'rolls back the transaction on thrown errors (no partial writes)',
    async () => {
      class Boom extends Error {}
      await expect(
        withTenantContext(
          sql,
          { tenant_id: 'tenant-rollback', user_id: 'u', role: 'viewer' },
          async () => {
            throw new Boom('rollback requested');
          }
        )
      ).rejects.toBeInstanceOf(Boom);

      // Confirms the failed transaction released the GUCs.
      const [after] = await sql`
        SELECT current_setting('app.current_tenant_id', true) AS tid
      `;
      expect(after.tid ?? '').toBe('');
    }
  );

  // Non-integration sanity check that always runs, even without DATABASE_URL.
  test('exports a function with the expected arity', () => {
    expect(typeof withTenantContext).toBe('function');
    expect(withTenantContext.length).toBe(3);
  });
});
