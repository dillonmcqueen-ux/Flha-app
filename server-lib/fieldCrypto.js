// server-lib/fieldCrypto.js
// Application-level encryption at rest for personal fields (today: email
// addresses on roster rows, and the recipient lists Company Portal
// schedules will hold). AES-256-GCM, one random 12-byte IV per value,
// stored as a single text string so it fits the existing text columns:
//
//     enc:v1:<iv base64url>:<auth tag base64url>:<ciphertext base64url>
//
// The key lives only in the FIELD_ENCRYPTION_KEY environment variable
// (32 random bytes, base64 or hex). It is never in the database, so a
// database or backup leak alone does not expose the values. LOSING THE KEY
// LOSES EVERY ENCRYPTED VALUE. Back it up somewhere other than Vercel.
//
// Behaviour worth knowing:
//   - encryptField fails closed: with no valid key it throws rather than
//     quietly writing plaintext.
//   - decryptField passes through any value without the `enc:v1:` prefix,
//     so rows written before the backfill keep working during rollout.
//   - Encryption is randomized, so an encrypted column can NOT be searched
//     or compared with .eq(). Nothing in this repo looks up roster rows by
//     email; keep it that way, or add a keyed hash column first.
// Lives outside api/ on purpose, same reason as server-lib/uploadUrls.js.

import crypto from 'crypto';

const PREFIX = 'enc:v1:';

function loadKey() {
  const raw = (process.env.FIELD_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('FIELD_ENCRYPTION_KEY is not set.');
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return key;
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

// null / undefined / '' stay as they are so "no email on file" is still null.
export function encryptField(plain) {
  if (plain === null || plain === undefined || plain === '') return plain ?? null;
  const text = String(plain);
  if (isEncrypted(text)) return text; // never double-encrypt
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
}

export function decryptField(stored) {
  if (stored === null || stored === undefined || stored === '') return stored ?? null;
  if (!isEncrypted(stored)) return stored; // legacy plaintext row
  const [ivB64, tagB64, ctB64] = String(stored).slice(PREFIX.length).split(':');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('Malformed encrypted field.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}

// Decrypts `email` on a row (or list of rows) without mutating the input.
// A row whose value can't be decrypted (wrong key, corrupted) gets
// email: null and is logged, so one bad row never takes down a whole list.
export function withDecryptedEmail(rowOrRows) {
  const one = (row) => {
    if (!row || !('email' in row)) return row;
    try {
      return { ...row, email: decryptField(row.email) };
    } catch (e) {
      console.error('decryptField failed for a roster email:', e.message);
      return { ...row, email: null };
    }
  };
  return Array.isArray(rowOrRows) ? rowOrRows.map(one) : one(rowOrRows);
}
