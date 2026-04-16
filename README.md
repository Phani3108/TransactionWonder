# 📒 TransactionWonder

> An AI bookkeeping platform for small businesses — autonomous, multi-tenant, and built for speed.

This repo is being rebuilt in phases. Each phase lands as a clean, pushable slice so progress is easy to follow.

---

## 🧠 What it does (in plain English)

- 📥 **Reads invoices** — pulls text out of PDFs and images, checks the numbers, and sorts them.
- 🏦 **Matches bank transactions** — lines up what’s in your bank with what’s in your books.
- 📊 **Writes financial reports** — P&L, balance sheet, cash flow, aging — on demand.
- 💳 **Pays bills** — approves invoices and kicks off payments (Stripe, ACH).
- 🔄 **Syncs with tools you already use** — QuickBooks, Xero, Plaid.
- 🛡️ **Keeps every business separate** — strict multi-tenant isolation at the database layer.
- 🧾 **Logs everything** — full audit trail for compliance.

---

## 🧩 What’s inside

- 🟡 **Bun + TypeScript** (strict mode) — backend runtime and language
- ⚡ **Hono** — small, fast HTTP framework
- 🐘 **PostgreSQL** — with Row-Level Security (RLS) and Role-Based Access Control (RBAC)
- ⚛️ **React + Vite + Tailwind + shadcn/ui** — the dashboard
- 🧠 **DeepSeek** (primary LLM) + **Google Document AI** (OCR) + **OpenAI SDK** (fallback)
- 💰 **Plaid, Stripe, QuickBooks, Xero** — external integrations
- 🧑‍✈️ **110 AI agents** — 1 CEO, 9 orchestrators, 100 workers (hierarchical, skill-driven)

---

## 🚀 How to run (local)

1. 🧪 **Copy the env template** and fill in your keys: `cp .env.example .env` *(example file coming in a future phase)*
2. 📦 **Install dependencies:** `bun install`
3. 🗄️ **Set up the database:** `bun run db:setup`
4. 🌱 **Seed demo data:** `bun run demo:quick`
5. ▶️ **Start the API:** `bun run dev`
6. 🖥️ **Start the dashboard (in another terminal):** `bun run dashboard:dev`

- API runs on **port 4004** by default (`PORT` env var to override).
- Dashboard runs on **port 3000**.

---

## 🔒 Tenant safety — why this matters

This is a **multi-tenant** system. Company A’s invoices must never, ever, be visible to Company B. We enforce that in two places at once:

- 🛡️ **In PostgreSQL** — every tenant-scoped table has Row-Level Security (RLS) policies tied to session variables.
- 🧭 **In the app layer** — every query filters by `tenant_id` explicitly. Belt *and* braces.

The RLS plumbing is the riskier of the two because it depends on those session variables being set correctly on every single request. Phase **P0-1** (below) fixes a real leak in that plumbing.

---

## 📝 Progress log

Each phase is a small, reviewable PR-sized change. One commit per phase, pushed to this repo.

| Phase | Status | Summary |
|---|---|---|
| **P0-1** — Tenant context hardening | ✅ Done | Transaction-scoped RLS session vars. Fixes pool bleed + SET injection. |
| **R** — Drop "ClawKeeper" brand | ✅ Done | Single name everywhere: **TransactionWonder**. CEO agent ID is now `ceo`. |
| **P0-2** — RLS isolation test suite | ✅ Done | 7 integration tests prove tenant A can’t read B, viewer can’t write, WITH CHECK blocks cross-tenant INSERTs, super_admin can. |
| P0-3 — CEO → orchestrator real delegation | ⏳ Next | Replace the mock `delegate_to()` with a real call. |
| P0-4 — Orchestrator → worker dispatch (AP Lead) | ⏳ Next | First vertical slice that actually uses workers. |
| P0-5 — Skill executor MVP | ⏳ Next | `invokeSkill()` + Zod schemas for `invoice-processor` + `payment-gateway`. |
| P0-6 — Task timeout | ⏳ Next | `Promise.race` wrapper so hung LLM calls don’t block forever. |
| P0-7 — Memory store tenant context | ⏳ Next | Memory queries go through the same wrapper. |
| *P1 items* | 🗓️ Planned | Shared HTTP wrapper (retry + circuit breaker), OAuth token persistence, webhooks, Stripe idempotency, JWT refresh, audit log persistence, parallel DAG, PII redaction. |
| *P2 items* | 🗓️ Planned | Hygiene: redundant RLS policies, bcrypt rounds, trace.end() fix, doc drift, env template, pgcrypto, branded types. |

---

## ✅ Latest phase: **P0-2 — RLS isolation test suite** (2026-04-17)

### 🎯 What changed

- 🧪 **New test file** at `tests/rls/isolation.test.ts` — 7 integration tests that spin up real data in two tenants and prove RLS blocks cross-tenant reads and writes through `withTenantContext()`.
- 🔒 **What’s proved**:
  - Tenant A sees exactly its own invoices; Tenant B likewise.
  - An `UPDATE` from tenant A aimed at tenant B’s rows → 0 rows affected.
  - `viewer` role cannot `INSERT` invoices (WITH CHECK blocks it).
  - `accountant` can insert in their own tenant but **not** with a spoofed `tenant_id` (cross-tenant WITH CHECK blocks it).
  - `super_admin` can read across tenants — the intended bypass, confirmed to work.
- 🧹 **Fixtures are self-contained** — UUIDs per run, clean-up in `afterAll`, no cross-test collisions.

### 🧪 How to run

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/transactionwonder bun test tests/rls
```

Self-skips without `DATABASE_URL`, same pattern as P0-1.

---

## 📜 Previous phase: **R — Drop "ClawKeeper" brand** (2026-04-17)

### 🎯 What changed

- ✏️ **315 references across 104 files** renamed in a single sweep — all prose, code, docs, SQL, config.
- 🏷️ **Brand** is now just **TransactionWonder** everywhere (no more dual "TransactionWonder / ClawKeeper" split).
- 🧑‍✈️ **CEO agent** is now identified as `ceo` instead of `clawkeeper` — same role, clearer name.
  - Class renamed: `ClawKeeperAgent` → `CeoAgent`.
  - File renamed: `src/agents/clawkeeper.ts` → `src/agents/ceo.ts`.
  - Dir renamed: `agents/clawkeeper/` → `agents/ceo/`.
  - Agent ID everywhere: `'clawkeeper'` → `'ceo'`.
- 📦 **Packages** renamed: root `transactionwonder`, dashboard `transactionwonder-dashboard`.
- 🗄️ **DB / service names** kept as the product name, not the agent name: `transactionwonder` database, `transactionwonder_service` role, etc.
- ✅ Full TypeScript typecheck still clean on every changed file.

### 🧪 Verification

- `grep -r "ClawKeeper\|clawkeeper"` across the whole tree → **0 hits**.
- No orphan references: `ceo` as an identifier only appears where it refers to the CEO agent role.

---

## 📜 Previous phase: **P0-1 — Tenant context hardening** (2026-04-17)

### 🐞 What was broken

- 🔴 **Cross-tenant leak via the connection pool.** The old middleware ran `SET app.current_tenant_id = '...'` which is **session-scoped**, not transaction-scoped. With a pool of 10 connections, one request’s tenant context could stick on a connection and be seen by the next request that reused it — a real multi-tenant bleed.
- 🔴 **SQL-injection-shaped SET command.** The same code did `sql.unsafe(\`SET app.current_tenant_id = '${decoded.tenant_id}'\`)`, string-interpolating a JWT value into raw SQL. Safe only while the JWT secret stayed secret.

### 🛠️ What changed

- ➕ **New helper** at `src/db/with-context.ts` — opens a Postgres transaction and sets the three RLS session variables via parameterized `set_config(name, value, true)` calls (transaction-scoped, no interpolation).
- 🔁 **Middleware rewrite** in `src/api/server.ts` — now wraps every authenticated request inside a `withTenantContext()` transaction and hands the transactional SQL client to the handler via `c.var.sql`.
- 🔁 **All 11 route files** now use `c.var.sql` instead of the module-scoped `sql` pool client. This is the only client with tenant context applied for the current request.
- 🧪 **Tests added** at `tests/rls/with-context.test.ts` — prove GUCs are scoped to the transaction, do not leak to the outer pool connection, stay isolated under concurrency, and treat injection-shaped values as data.
- 🚰 **SSE streaming edge case handled** — the streaming endpoint opens its own short-lived `withTenantContext()` for the audit write that happens after the outer transaction has committed.

### ✅ Result

- No cross-tenant GUC bleed.
- No SQL injection path via `SET`.
- Any route handler throw → full transaction rollback (stronger consistency than before).
- Full TypeScript typecheck passes on every changed file.

### 🧪 How to test this phase

```bash
# Requires a running Postgres instance.
DATABASE_URL=postgres://user:pass@localhost:5432/transactionwonder bun test tests/rls
```

The test suite self-skips if `DATABASE_URL` is not set, so CI without a DB still passes.

### 📁 Files touched in this phase

- 🆕 `src/db/with-context.ts`
- 🆕 `tests/rls/with-context.test.ts`
- ✏️ `src/api/server.ts`
- ✏️ `src/types/hono.ts`
- ✏️ `src/api/routes/{auth,invoices,reports,reconciliation,accounts,agents,dashboard,activity,vendors,customers,metrics}.ts`

---

## 🗺️ What’s next

- **P0-2** — RLS isolation test suite (tenant A can’t read tenant B, viewer can’t write, etc.)
- **P0-3 + P0-4** — Wire the CEO → Orchestrator → Worker execution spine end-to-end on the AP Lead slice.
- **P0-5** — Build `src/skills/` with a real skill executor.

---

## 🙏 Credits

Built with care by **[Phani Marupaka](https://linkedin.com/in/Phani-marupaka)** 👋

- 🧠 Architecture, product direction, and every line of code you see here.
- 🤖 Audit + refactor cadence supported by Claude Code.
- 💬 Feedback, ideas, contributions — all welcome.

---

*📜 License: MIT*
