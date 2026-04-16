// file: src/api/server.ts
// description: Hono API server for ClawKeeper with multi-tenant support
// reference: src/api/routes/*.ts, Constellation server pattern

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import postgres from 'postgres';
import jwt from 'jsonwebtoken';
import { guardrails_middleware } from '../guardrails';
import { withTenantContext } from '../db/with-context';
import { auth_routes } from './routes/auth';
import { invoice_routes } from './routes/invoices';
import { report_routes } from './routes/reports';
import { reconciliation_routes } from './routes/reconciliation';
import { agent_routes } from './routes/agents';
import { account_routes } from './routes/accounts';
import { create_dashboard_routes } from './routes/dashboard';
import { create_activity_routes } from './routes/activity';
import { create_vendor_routes } from './routes/vendors';
import { create_customer_routes } from './routes/customers';
import { create_metrics_routes } from './routes/metrics';
import type { AppEnv } from '../types/hono';

// Database connection (module-scoped pool). Never use this client directly
// from inside a route handler — use `c.var.sql` instead, which is set by the
// tenant-context middleware and is either a transaction-scoped client (with
// RLS session vars set LOCAL) or the base pool client for public routes.
const sql = postgres(process.env.DATABASE_URL!, {
  max: 10,
  idle_timeout: 20,
});

// Create Hono app with typed environment
const app = new Hono<AppEnv>();

// Middleware
app.use('*', cors());
app.use('*', logger());

// Guardrails middleware (rate limiting, PII detection, injection detection)
app.use('/api/*', guardrails_middleware);

// Tenant context middleware.
//
// For public endpoints (login, health, agents/status) this middleware just
// attaches the module-scoped `sql` pool to the request and moves on.
//
// For authenticated endpoints it:
//   1. verifies the JWT,
//   2. stores tenant_id / user_id / role on the Hono context,
//   3. opens a transaction via `withTenantContext()` with RLS session vars
//      set LOCAL to that transaction, and
//   4. attaches the transaction client to the request (`c.var.sql`) so the
//      route handler's queries run with correct tenant isolation.
//
// Any downstream throw rolls back the transaction; a clean return commits.
// See src/db/with-context.ts for the full rationale.
app.use('/api/*', async (c, next) => {
  const auth_header = c.req.header('Authorization');

  if (!auth_header || !auth_header.startsWith('Bearer ')) {
    // Public endpoints: no tenant context, use the base pool client.
    if (
      c.req.path === '/api/auth/login' ||
      c.req.path === '/api/health' ||
      c.req.path === '/api/agents/status'
    ) {
      c.set('sql', sql);
      return next();
    }

    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = auth_header.substring(7);

  const jwt_secret = process.env.JWT_SECRET;
  if (!jwt_secret) {
    console.error('[Auth] JWT_SECRET not configured');
    return c.json({ error: 'Server configuration error' }, 500);
  }

  let decoded: { tenant_id: string; user_id: string; role: string };
  try {
    decoded = jwt.verify(token, jwt_secret) as {
      tenant_id: string;
      user_id: string;
      role: string;
    };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return c.json({ error: 'Token expired' }, 401);
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return c.json({ error: 'Invalid token' }, 401);
    }
    console.error('[Auth] Token verification error:', error);
    return c.json({ error: 'Authentication failed' }, 401);
  }

  if (!decoded.tenant_id || !decoded.user_id || !decoded.role) {
    return c.json({ error: 'Token missing required claims' }, 401);
  }

  c.set('tenant_id', decoded.tenant_id);
  c.set('user_id', decoded.user_id);
  c.set('user_role', decoded.role);

  // Open a transaction for the request with LOCAL RLS session vars applied,
  // then call next() inside it so handlers see the transactional client via
  // c.var.sql. Commits on clean return; rolls back on throw.
  return withTenantContext(
    sql,
    {
      tenant_id: decoded.tenant_id,
      user_id: decoded.user_id,
      role: decoded.role,
    },
    async (tx) => {
      c.set('sql', tx);
      await next();
    }
  );
});

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'clawkeeper-api',
    version: '0.1.0',
  });
});

// Routes
app.route('/api/auth', auth_routes(sql));
app.route('/api/invoices', invoice_routes(sql));
app.route('/api/reports', report_routes(sql));
app.route('/api/reconciliation', reconciliation_routes(sql));
app.route('/api/agents', agent_routes(sql));
app.route('/api/accounts', account_routes(sql));
app.route('/api/dashboard', create_dashboard_routes(sql));
app.route('/api/activity', create_activity_routes(sql));
app.route('/api/vendors', create_vendor_routes(sql));
app.route('/api/customers', create_customer_routes(sql));
app.route('/api/metrics', create_metrics_routes(sql));

// WebSocket endpoint (NOT IMPLEMENTED)
app.get('/ws', (c) => {
  // TODO: Implement WebSocket support for real-time agent updates
  return c.json({
    error: 'WebSocket not yet implemented',
    message: 'This endpoint will provide real-time agent status updates',
  }, 501);
});

// Start server
const port = Number(process.env.PORT) || 4004;

// Validate port configuration
const EXPECTED_PORT = 9100;
if (port !== EXPECTED_PORT) {
  console.error(`
╔═════════════════════════════════════════════════════════════════╗
║  ⚠️  PORT CONFIGURATION MISMATCH DETECTED                       ║
╚═════════════════════════════════════════════════════════════════╝

Expected Port: ${EXPECTED_PORT}
Current Port:  ${port}

This mismatch will cause the dashboard to fail connecting to the API.

ACTION REQUIRED:
1. Update your .env file: PORT=${EXPECTED_PORT}
2. Restart the API server

Continuing with port ${port} anyway, but connections may fail...
`);
}

console.log(`
╔═════════════════════════════════════════════════════════════════╗
║  🔐 ClawKeeper API Server                                       ║
╚═════════════════════════════════════════════════════════════════╝

Port:        ${port}
Environment: ${process.env.NODE_ENV || 'development'}
Database:    ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}
JWT Secret:  ${process.env.JWT_SECRET ? 'Configured' : '⚠️  NOT CONFIGURED - Using default'}

Health:      http://localhost:${port}/health
API:         http://localhost:${port}/api
Dashboard:   http://localhost:3000

Ready for requests...
`);

export default {
  port,
  fetch: app.fetch,
};
