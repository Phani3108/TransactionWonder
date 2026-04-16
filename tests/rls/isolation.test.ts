// file: tests/rls/isolation.test.ts
// description: End-to-end proof that RLS policies block cross-tenant reads
//              and role-based writes. Uses withTenantContext() for every
//              connection, so it exercises the real middleware path.
//
// Run with: DATABASE_URL=postgres://... bun test tests/rls
//
// The suite self-skips if DATABASE_URL is not set. All fixture data is
// keyed by UUIDs generated per run, so repeat runs don't collide.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres, { type Sql } from 'postgres';
import { v4 as uuid } from 'uuid';
import { withTenantContext } from '../../src/db/with-context';

const DATABASE_URL = process.env.DATABASE_URL;
const runIntegration = Boolean(DATABASE_URL);
const itIntegration = runIntegration ? test : test.skip;

// Per-run identifiers so repeated runs don't collide on unique constraints.
const TENANT_A = uuid();
const TENANT_B = uuid();
const USER_A_ADMIN = uuid();
const USER_A_VIEWER = uuid();
const USER_B_ADMIN = uuid();
const runTag = Date.now().toString(36);

describe('RLS isolation — cross-tenant reads and role-based writes', () => {
  let sql: Sql<Record<string, unknown>>;

  beforeAll(async () => {
    if (!runIntegration) return;
    // max=2 forces connection reuse across tests, giving the pool-bleed
    // path every chance to show up if withTenantContext is broken.
    sql = postgres(DATABASE_URL!, { max: 2, idle_timeout: 1 });

    // Seed tenant A with 2 invoices.
    await withTenantContext(
      sql,
      { tenant_id: TENANT_A, user_id: USER_A_ADMIN, role: 'tenant_admin' },
      async (tx) => {
        await tx`INSERT INTO tenants (id, name) VALUES (${TENANT_A}, ${'Test-A-' + runTag})`;
        await tx`
          INSERT INTO users (id, tenant_id, email, password_hash, role, name)
          VALUES
            (${USER_A_ADMIN},  ${TENANT_A}, ${'a-admin-'  + runTag + '@test.dev'}, 'h', 'tenant_admin', 'A admin'),
            (${USER_A_VIEWER}, ${TENANT_A}, ${'a-viewer-' + runTag + '@test.dev'}, 'h', 'viewer',       'A viewer')
        `;
        await tx`
          INSERT INTO invoices
            (tenant_id, vendor_name, invoice_number, invoice_date, due_date, amount, status)
          VALUES
            (${TENANT_A}, 'Vendor A1', ${'A-INV-1-' + runTag}, NOW(), NOW() + INTERVAL '30 days', 10000, 'draft'),
            (${TENANT_A}, 'Vendor A2', ${'A-INV-2-' + runTag}, NOW(), NOW() + INTERVAL '30 days', 20000, 'draft')
        `;
      }
    );

    // Seed tenant B with 2 invoices.
    await withTenantContext(
      sql,
      { tenant_id: TENANT_B, user_id: USER_B_ADMIN, role: 'tenant_admin' },
      async (tx) => {
        await tx`INSERT INTO tenants (id, name) VALUES (${TENANT_B}, ${'Test-B-' + runTag})`;
        await tx`
          INSERT INTO users (id, tenant_id, email, password_hash, role, name)
          VALUES
            (${USER_B_ADMIN}, ${TENANT_B}, ${'b-admin-' + runTag + '@test.dev'}, 'h', 'tenant_admin', 'B admin')
        `;
        await tx`
          INSERT INTO invoices
            (tenant_id, vendor_name, invoice_number, invoice_date, due_date, amount, status)
          VALUES
            (${TENANT_B}, 'Vendor B1', ${'B-INV-1-' + runTag}, NOW(), NOW() + INTERVAL '30 days', 50000, 'draft'),
            (${TENANT_B}, 'Vendor B2', ${'B-INV-2-' + runTag}, NOW(), NOW() + INTERVAL '30 days', 60000, 'draft')
        `;
      }
    );
  });

  afterAll(async () => {
    if (!runIntegration) return;
    try {
      // Cascade-delete the test tenants. Requires super_admin since other
      // tenants' rows may be involved in indexes / constraints, and
      // DELETE needs to pass the USING clause.
      await withTenantContext(
        sql,
        { tenant_id: TENANT_A, user_id: USER_A_ADMIN, role: 'super_admin' },
        async (tx) => {
          await tx`DELETE FROM tenants WHERE id = ${TENANT_A}`;
        }
      );
      await withTenantContext(
        sql,
        { tenant_id: TENANT_B, user_id: USER_B_ADMIN, role: 'super_admin' },
        async (tx) => {
          await tx`DELETE FROM tenants WHERE id = ${TENANT_B}`;
        }
      );
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  itIntegration(
    'tenant A sees only its own invoices',
    async () => {
      const rows = await withTenantContext(
        sql,
        { tenant_id: TENANT_A, user_id: USER_A_ADMIN, role: 'tenant_admin' },
        async (tx) =>
          await tx<{ tenant_id: string; invoice_number: string }[]>`
            SELECT tenant_id, invoice_number FROM invoices
            WHERE invoice_number LIKE ${'%-' + runTag}
          `
      );
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r.tenant_id).toBe(TENANT_A);
    }
  );

  itIntegration(
    'tenant B sees only its own invoices',
    async () => {
      const rows = await withTenantContext(
        sql,
        { tenant_id: TENANT_B, user_id: USER_B_ADMIN, role: 'tenant_admin' },
        async (tx) =>
          await tx<{ tenant_id: string; invoice_number: string }[]>`
            SELECT tenant_id, invoice_number FROM invoices
            WHERE invoice_number LIKE ${'%-' + runTag}
          `
      );
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r.tenant_id).toBe(TENANT_B);
    }
  );

  itIntegration(
    'tenant A UPDATE targeting tenant B by id returns 0 rows affected',
    async () => {
      const result = await withTenantContext(
        sql,
        { tenant_id: TENANT_A, user_id: USER_A_ADMIN, role: 'tenant_admin' },
        async (tx) => {
          // Grab the id of a tenant B invoice by deliberately bypassing RLS
          // just for the test (switching context for one sub-query).
          // We can't do this through the current tx; instead, we target by
          // invoice_number which is visible only to tenant B — so this
          // query from tenant A's context will find nothing, confirming
          // the read block. For a stronger write-block assertion, we
          // attempt the UPDATE with a known tenant_id filter:
          const updated = await tx`
            UPDATE invoices
            SET status = 'cancelled'
            WHERE tenant_id = ${TENANT_B}
            RETURNING id
          `;
          return updated.length;
        }
      );
      expect(result).toBe(0);
    }
  );

  itIntegration(
    'viewer role cannot INSERT invoices (blocked by RLS WITH CHECK)',
    async () => {
      let threw = false;
      try {
        await withTenantContext(
          sql,
          { tenant_id: TENANT_A, user_id: USER_A_VIEWER, role: 'viewer' },
          async (tx) => {
            await tx`
              INSERT INTO invoices
                (tenant_id, vendor_name, invoice_number, invoice_date, due_date, amount, status)
              VALUES
                (${TENANT_A}, 'Vendor A3', ${'A-INV-VIEWER-' + runTag}, NOW(), NOW() + INTERVAL '30 days', 1, 'draft')
            `;
          }
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    }
  );

  itIntegration(
    'accountant can INSERT into their own tenant',
    async () => {
      const rowId = uuid();
      await withTenantContext(
        sql,
        { tenant_id: TENANT_A, user_id: USER_A_ADMIN, role: 'accountant' },
        async (tx) => {
          await tx`
            INSERT INTO invoices
              (id, tenant_id, vendor_name, invoice_number, invoice_date, due_date, amount, status)
            VALUES
              (${rowId}, ${TENANT_A}, 'Vendor A3', ${'A-INV-3-' + runTag}, NOW(), NOW() + INTERVAL '30 days', 30000, 'draft')
          `;
        }
      );
      const rows = await withTenantContext(
        sql,
        { tenant_id: TENANT_A, user_id: USER_A_ADMIN, role: 'tenant_admin' },
        async (tx) =>
          await tx<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${rowId}`
      );
      expect(rows).toHaveLength(1);
    }
  );

  itIntegration(
    'accountant INSERT with mismatched tenant_id is blocked by WITH CHECK',
    async () => {
      let threw = false;
      try {
        await withTenantContext(
          sql,
          { tenant_id: TENANT_A, user_id: USER_A_ADMIN, role: 'accountant' },
          async (tx) => {
            await tx`
              INSERT INTO invoices
                (tenant_id, vendor_name, invoice_number, invoice_date, due_date, amount, status)
              VALUES
                (${TENANT_B}, 'Evil Vendor', ${'EVIL-' + runTag}, NOW(), NOW() + INTERVAL '30 days', 9999, 'draft')
            `;
          }
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    }
  );

  itIntegration(
    'super_admin can read across tenants',
    async () => {
      const rows = await withTenantContext(
        sql,
        { tenant_id: TENANT_A, user_id: USER_A_ADMIN, role: 'super_admin' },
        async (tx) =>
          await tx<{ tenant_id: string }[]>`
            SELECT tenant_id FROM invoices
            WHERE invoice_number LIKE ${'%-' + runTag}
          `
      );
      const distinct = new Set(rows.map((r) => r.tenant_id));
      expect(distinct.has(TENANT_A)).toBe(true);
      expect(distinct.has(TENANT_B)).toBe(true);
    }
  );

  test('suite is wired (always passes)', () => {
    expect(typeof withTenantContext).toBe('function');
  });
});
