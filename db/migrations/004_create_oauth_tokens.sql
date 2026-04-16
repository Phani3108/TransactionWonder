-- Migration: 004_create_oauth_tokens
-- Description: Persistent OAuth token storage for external integrations
--              (QuickBooks, Xero, Plaid). Tokens are stored pre-encrypted
--              by the app (AES-256-GCM with OAUTH_ENCRYPTION_KEY) so that
--              a database dump alone is not enough to replay them.
-- Phase: P1-2

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Which integration this token is for. Kept as VARCHAR (not an enum)
  -- so adding a provider is a code change, not a DB migration.
  provider VARCHAR(50) NOT NULL,

  -- The external-system tenancy identifier (QuickBooks realmId,
  -- Xero tenant/org id, Plaid item_id). Null when the provider doesn't
  -- expose one. Used so a single tenant_id can hold multiple sub-accounts.
  external_realm_id VARCHAR(255),

  -- Pre-encrypted ciphertext. The app encrypts with
  -- OAUTH_ENCRYPTION_KEY before writing and decrypts on read. Stored as
  -- TEXT because the ciphertext is base64-encoded (iv:tag:payload).
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT,

  -- Wall-clock expiry of the access token as reported by the provider.
  access_token_expires_at TIMESTAMPTZ NOT NULL,

  -- Space-delimited scopes (matches OAuth2 convention).
  scope TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- At most one active token per (tenant, provider, realm). Re-auth
  -- replaces the existing row in place via UPSERT.
  UNIQUE (tenant_id, provider, external_realm_id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_tenant_provider
  ON oauth_tokens (tenant_id, provider);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expiring_soon
  ON oauth_tokens (access_token_expires_at)
  WHERE access_token_expires_at IS NOT NULL;

-- RLS: tenant isolation. Same pattern as the rest of the multi-tenant
-- tables — USING handles SELECT/UPDATE/DELETE, WITH CHECK enforces that
-- INSERT/UPDATE rows always land in the caller's tenant.
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY oauth_tokens_tenant_isolation ON oauth_tokens
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- updated_at trigger — keeps writes consistent with the rest of the schema.
CREATE OR REPLACE FUNCTION update_oauth_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS oauth_tokens_updated_at_trigger ON oauth_tokens;
CREATE TRIGGER oauth_tokens_updated_at_trigger
  BEFORE UPDATE ON oauth_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_oauth_tokens_updated_at();

COMMENT ON TABLE oauth_tokens IS 'Encrypted OAuth access + refresh tokens for external integrations (QuickBooks, Xero, Plaid, etc.)';
COMMENT ON COLUMN oauth_tokens.access_token_ciphertext IS 'AES-256-GCM ciphertext; decrypt with OAUTH_ENCRYPTION_KEY on read';
