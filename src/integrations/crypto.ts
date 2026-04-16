// file: src/integrations/crypto.ts
// description: Symmetric encryption for at-rest secrets (OAuth tokens,
//              webhook secrets). Uses AES-256-GCM with a 32-byte key
//              supplied via OAUTH_ENCRYPTION_KEY (base64 encoded).
//              Ciphertext format: base64(iv || authTag || ciphertext)
//
//              This is not a replacement for column-level pgcrypto — a DB
//              dump alone is not enough to replay tokens because the key
//              lives outside the DB. For defense in depth, pgcrypto on
//              top of this is still a good idea (tracked in P2).

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

function resolveKey(): Buffer {
  const b64 = process.env.OAUTH_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      'OAUTH_ENCRYPTION_KEY is not set. Generate one with: ' +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `OAUTH_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes; got ${key.length}`
    );
  }
  return key;
}

/** Encrypt a plaintext string; returns base64(iv||tag||ciphertext). */
export function encryptSecret(plaintext: string): string {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Decrypt a base64(iv||tag||ciphertext) produced by `encryptSecret`. */
export function decryptSecret(payload: string): string {
  const key = resolveKey();
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Ciphertext too short');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
