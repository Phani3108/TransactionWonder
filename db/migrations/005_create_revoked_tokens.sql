-- Migration: 005_create_revoked_tokens
-- Description: JWT revocation list. Rows are added on logout, password
--              rotation, explicit admin revoke, or refresh-token rotation.
--              Tokens are indexed by jti (JWT ID claim) so lookup is O(1).
-- Phase: P1-7

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS revoked_tokens (
  -- jti claim from the JWT. Required; that's the whole point of jti.
  jti VARCHAR(255) PRIMARY KEY,

  -- Bookkeeping.
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_type VARCHAR(20) NOT NULL CHECK (token_type IN ('access', 'refresh')),

  -- When the JWT's own `exp` claim expires. After this the row can be
  -- garbage-collected without risk — an expired JWT is rejected by the
  -- verifier regardless of whether it's on the revocation list.
  jwt_expires_at TIMESTAMPTZ NOT NULL,

  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT
);

-- Cleanup lookup: "which rows can we garbage-collect?"
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_gc
  ON revoked_tokens (jwt_expires_at);

-- NO RLS on revoked_tokens: the middleware needs to query it BEFORE the
-- tenant context is set (it checks the incoming JWT itself). Safe because
-- the only field that matters is the opaque jti; we store tenant_id only
-- for audit. INSERTs happen inside the tenant context from the auth
-- routes so we still know who did what.

COMMENT ON TABLE revoked_tokens IS 'JWT revocation list indexed by jti claim';
