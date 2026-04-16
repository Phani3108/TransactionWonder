// file: src/api/routes/auth.ts
// description: Authentication routes for TransactionWonder API.
//              P1-7: short-lived access tokens + long-lived refresh
//              tokens + a revocation list.
// reference: src/api/server.ts, db/migrations/005_create_revoked_tokens.sql

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { AppEnv } from '../../types/hono';

// Default lifetimes. Overridable via env for ops tuning. Access tokens are
// deliberately short (1h) so a stolen token has a tight blast radius;
// refresh tokens are longer (30d) and revocable.
const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TTL || '1h';
const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_TTL || '30d';

type TokenType = 'access' | 'refresh';
interface BaseClaims {
  user_id: string;
  tenant_id: string;
  role: string;
  jti: string; // JWT ID, used for revocation
  token_type: TokenType;
}

function issueToken(
  base: Omit<BaseClaims, 'jti' | 'token_type'> & { email?: string },
  type: TokenType,
  secret: string
): { token: string; jti: string } {
  const jti = randomUUID();
  const expiresIn = type === 'access' ? ACCESS_TOKEN_TTL : REFRESH_TOKEN_TTL;
  const token = jwt.sign(
    { ...base, jti, token_type: type },
    secret,
    { expiresIn } as SignOptions
  );
  return { token, jti };
}

export function auth_routes(_sql: Sql<Record<string, unknown>>) {
  const app = new Hono<AppEnv>();

  // ---------------------------------------------------------------------
  // POST /login — exchange password for (access, refresh) token pair
  // ---------------------------------------------------------------------
  app.post('/login', async (c) => {
    try {
      const { email, password } = await c.req.json();
      if (!email || !password) {
        return c.json({ error: 'Email and password are required' }, 400);
      }

      const [user] = await c.var.sql<
        {
          id: string;
          tenant_id: string;
          email: string;
          password_hash: string;
          role: string;
          name: string;
        }[]
      >`
        SELECT id, tenant_id, email, password_hash, role, name
        FROM users
        WHERE email = ${email}
      `;
      if (!user) return c.json({ error: 'Invalid credentials' }, 401);

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return c.json({ error: 'Invalid credentials' }, 401);

      const jwt_secret = process.env.JWT_SECRET;
      if (!jwt_secret) {
        console.error('[Auth] JWT_SECRET not configured');
        return c.json({ error: 'Server configuration error' }, 500);
      }

      const basePayload = {
        user_id: user.id,
        tenant_id: user.tenant_id,
        role: user.role,
        email: user.email,
      };
      const access = issueToken(basePayload, 'access', jwt_secret);
      const refresh = issueToken(basePayload, 'refresh', jwt_secret);

      await c.var.sql`UPDATE users SET last_login = NOW() WHERE id = ${user.id}`;

      return c.json({
        user: {
          id: user.id,
          tenant_id: user.tenant_id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        access_token: access.token,
        refresh_token: refresh.token,
        // Keep legacy `token` field for dashboard back-compat until the
        // dashboard PR picks up the new field names.
        token: access.token,
      });
    } catch (error) {
      console.error('[Auth] Login error:', error);
      return c.json({ error: 'Authentication failed' }, 500);
    }
  });

  // ---------------------------------------------------------------------
  // POST /refresh — rotate a refresh token for a fresh access token
  //
  // - Validates the presented refresh token.
  // - Rejects if revoked.
  // - Issues a NEW refresh token and marks the OLD one revoked
  //   (refresh-token rotation, prevents replay if one is stolen).
  // ---------------------------------------------------------------------
  app.post('/refresh', async (c) => {
    const jwt_secret = process.env.JWT_SECRET;
    if (!jwt_secret) {
      return c.json({ error: 'Server configuration error' }, 500);
    }

    let presented: BaseClaims;
    try {
      const { refresh_token } = await c.req.json();
      if (!refresh_token) return c.json({ error: 'refresh_token required' }, 400);
      presented = jwt.verify(refresh_token, jwt_secret) as BaseClaims;
    } catch {
      return c.json({ error: 'Invalid refresh token' }, 401);
    }
    if (presented.token_type !== 'refresh') {
      return c.json({ error: 'Not a refresh token' }, 401);
    }

    // Is it on the revocation list?
    const [revoked] = await c.var.sql<{ jti: string }[]>`
      SELECT jti FROM revoked_tokens WHERE jti = ${presented.jti} LIMIT 1
    `;
    if (revoked) return c.json({ error: 'Refresh token revoked' }, 401);

    // Revoke the presented refresh token (rotation).
    await c.var.sql`
      INSERT INTO revoked_tokens (jti, tenant_id, user_id, token_type, jwt_expires_at, reason)
      VALUES (${presented.jti}, ${presented.tenant_id}, ${presented.user_id},
              'refresh', NOW() + INTERVAL '30 days', 'rotation')
      ON CONFLICT (jti) DO NOTHING
    `;

    // Issue a fresh pair.
    const base = {
      user_id: presented.user_id,
      tenant_id: presented.tenant_id,
      role: presented.role,
    };
    const access = issueToken(base, 'access', jwt_secret);
    const refresh = issueToken(base, 'refresh', jwt_secret);

    return c.json({
      access_token: access.token,
      refresh_token: refresh.token,
      token: access.token, // back-compat
    });
  });

  // ---------------------------------------------------------------------
  // POST /logout — revoke the caller's current access token (and refresh
  // token if supplied). Idempotent.
  // ---------------------------------------------------------------------
  app.post('/logout', async (c) => {
    const jwt_secret = process.env.JWT_SECRET;
    if (!jwt_secret) return c.json({ error: 'Server configuration error' }, 500);

    const authHeader = c.req.header('authorization') ?? '';
    const accessTokenRaw = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : null;

    const tenant_id = c.get('tenant_id');
    const user_id = c.get('user_id');

    // Revoke the access token (if any).
    if (accessTokenRaw) {
      try {
        const claims = jwt.verify(accessTokenRaw, jwt_secret) as BaseClaims;
        if (claims?.jti) {
          await c.var.sql`
            INSERT INTO revoked_tokens (jti, tenant_id, user_id, token_type, jwt_expires_at, reason)
            VALUES (${claims.jti}, ${tenant_id}, ${user_id}, 'access',
                    to_timestamp(${(jwt.decode(accessTokenRaw) as { exp?: number } | null)?.exp ?? 0}),
                    'logout')
            ON CONFLICT (jti) DO NOTHING
          `;
        }
      } catch {
        // already invalid — nothing to revoke
      }
    }

    // Also revoke a refresh token if the client sent one.
    try {
      const { refresh_token } = await c.req.json().catch(() => ({}));
      if (refresh_token) {
        const claims = jwt.verify(refresh_token, jwt_secret) as BaseClaims;
        if (claims?.jti) {
          await c.var.sql`
            INSERT INTO revoked_tokens (jti, tenant_id, user_id, token_type, jwt_expires_at, reason)
            VALUES (${claims.jti}, ${tenant_id}, ${user_id}, 'refresh',
                    NOW() + INTERVAL '30 days', 'logout')
            ON CONFLICT (jti) DO NOTHING
          `;
        }
      }
    } catch {
      /* ignore */
    }

    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------------
  // GET /me
  // ---------------------------------------------------------------------
  app.get('/me', async (c) => {
    try {
      const user_id = c.get('user_id');
      const tenant_id = c.get('tenant_id');

      const [user] = await c.var.sql`
        SELECT id, tenant_id, email, name, role, created_at, last_login
        FROM users
        WHERE id = ${user_id}
        AND tenant_id = ${tenant_id}
      `;
      if (!user) return c.json({ error: 'User not found' }, 404);
      return c.json({ user });
    } catch (error) {
      console.error('[Auth] Get user error:', error);
      return c.json({ error: 'Failed to fetch user' }, 500);
    }
  });

  return app;
}
