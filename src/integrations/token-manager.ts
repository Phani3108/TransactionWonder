// file: src/integrations/token-manager.ts
// description: Per-tenant OAuth token persistence + automatic refresh for
//              external integrations. Tokens are encrypted at rest with the
//              AES-GCM helper in src/integrations/crypto.ts. RLS on the
//              oauth_tokens table ensures a tenant can never observe
//              another tenant's tokens.
// reference: db/migrations/004_create_oauth_tokens.sql

import type { Sql } from 'postgres';
import { encryptSecret, decryptSecret } from './crypto';

export type OAuthProvider = 'quickbooks' | 'xero' | 'plaid' | 'stripe';

export interface StoredTokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: string; // ISO
  scope: string | null;
  external_realm_id: string | null;
}

/**
 * A pluggable token refresher. Each provider knows how to exchange its
 * refresh_token for a new access_token and returns the new tokens in the
 * same shape. Wire real implementations in the Xero / QuickBooks clients
 * (they already have exchangeCodeForTokens / refreshAccessToken methods).
 */
export type TokenRefresher = (current: StoredTokens) => Promise<StoredTokens>;

/**
 * TokenManager: one instance per process, receives a tx-scoped sql client
 * per-call (so every read + write runs through the RLS GUC plumbing).
 *
 * Usage:
 *   await withTenantContext(sql, ctx, async tx => {
 *     const tokens = await tokenManager.get(tx, 'quickbooks');
 *     if (tokens) await doSomething(tokens.access_token);
 *   });
 */
export class TokenManager {
  private refreshers: Partial<Record<OAuthProvider, TokenRefresher>> = {};

  registerRefresher(provider: OAuthProvider, refresher: TokenRefresher): void {
    this.refreshers[provider] = refresher;
  }

  /**
   * Read the stored token, decrypting on the way out. Auto-refreshes if
   * the access token is within 60s of expiry and a refresher is registered.
   * Returns null if no token row exists.
   */
  async get(
    sql: Sql<Record<string, unknown>>,
    provider: OAuthProvider,
    external_realm_id: string | null = null
  ): Promise<StoredTokens | null> {
    const rows = await sql<{
      access_token_ciphertext: string;
      refresh_token_ciphertext: string | null;
      access_token_expires_at: Date;
      scope: string | null;
      external_realm_id: string | null;
    }[]>`
      SELECT access_token_ciphertext, refresh_token_ciphertext,
             access_token_expires_at, scope, external_realm_id
      FROM oauth_tokens
      WHERE provider = ${provider}
        AND (external_realm_id IS NOT DISTINCT FROM ${external_realm_id})
      LIMIT 1
    `;
    if (rows.length === 0) return null;

    const row = rows[0];
    let tokens: StoredTokens = {
      access_token: decryptSecret(row.access_token_ciphertext),
      refresh_token: row.refresh_token_ciphertext
        ? decryptSecret(row.refresh_token_ciphertext)
        : null,
      expires_at: row.access_token_expires_at.toISOString(),
      scope: row.scope,
      external_realm_id: row.external_realm_id,
    };

    const expires_ms = row.access_token_expires_at.getTime();
    const needs_refresh = expires_ms - Date.now() < 60_000; // <60s to go
    if (needs_refresh && tokens.refresh_token && this.refreshers[provider]) {
      try {
        const refreshed = await this.refreshers[provider]!(tokens);
        await this.upsert(sql, provider, refreshed);
        tokens = refreshed;
      } catch (err) {
        console.warn(
          `[TokenManager] Refresh failed for ${provider}; returning stale token. ${String(err)}`
        );
      }
    }

    return tokens;
  }

  /**
   * Insert or update the token row for (current tenant, provider, realm).
   * Encryption happens here — callers only ever see plaintext.
   */
  async upsert(
    sql: Sql<Record<string, unknown>>,
    provider: OAuthProvider,
    tokens: StoredTokens
  ): Promise<void> {
    const access_ct = encryptSecret(tokens.access_token);
    const refresh_ct = tokens.refresh_token ? encryptSecret(tokens.refresh_token) : null;
    await sql`
      INSERT INTO oauth_tokens
        (tenant_id, provider, external_realm_id,
         access_token_ciphertext, refresh_token_ciphertext,
         access_token_expires_at, scope)
      VALUES
        (current_setting('app.current_tenant_id', true)::uuid,
         ${provider},
         ${tokens.external_realm_id},
         ${access_ct},
         ${refresh_ct},
         ${tokens.expires_at}::timestamptz,
         ${tokens.scope})
      ON CONFLICT (tenant_id, provider, external_realm_id)
      DO UPDATE SET
        access_token_ciphertext = EXCLUDED.access_token_ciphertext,
        refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        scope = EXCLUDED.scope,
        updated_at = NOW()
    `;
  }

  /** Permanently delete the token row. Use on explicit disconnect. */
  async revoke(
    sql: Sql<Record<string, unknown>>,
    provider: OAuthProvider,
    external_realm_id: string | null = null
  ): Promise<void> {
    await sql`
      DELETE FROM oauth_tokens
      WHERE provider = ${provider}
        AND (external_realm_id IS NOT DISTINCT FROM ${external_realm_id})
    `;
  }
}

// Process-wide singleton. Instances are cheap; the real state lives in the
// DB. Refreshers are registered by each integration module when it loads.
export const tokenManager = new TokenManager();
