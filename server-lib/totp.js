// server-lib/totp.js
// TOTP (RFC 6238) enrollment and verification for FORA's two privileged
// login paths (admin role, master code) — see
// docs/schema/mfa-totp-migration.sql and docs/security/soc2-readiness-gaps.md
// for why this exists and its deliberately narrow scope. Uses the `otpauth`
// library rather than hand-rolled HOTP/TOTP crypto: this is exactly the
// class of code that should come from a vetted implementation, not a
// bespoke one.

import * as OTPAuth from 'otpauth';
import crypto from 'crypto';
import { genSalt, hashPin } from './onboardingApproval.js';

const ISSUER = 'FORA';
const LABEL = 'FORA Admin';

export function generateTotpSecret() {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function buildTotp(secret, label = LABEL) {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

// otpauth://... URI for the enrollment QR code. Never logged or returned
// after the initial enrollment response.
export function totpEnrollmentUri(secret, label) {
  return buildTotp(secret, label || LABEL).toString();
}

// window: 1 allows the code from one 30s step before/after the server's
// clock, so a slightly-off device clock or the seconds ticking over
// mid-entry doesn't spuriously fail a correct code.
export function verifyTotpCode(secret, token) {
  if (!secret || !token || typeof token !== 'string') return false;
  const cleaned = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  const delta = buildTotp(secret).validate({ token: cleaned, window: 1 });
  return delta !== null;
}

// Like verifyTotpCode, but returns the 30 second time step the code belongs
// to (or null). Per-person logins store the last accepted step and refuse
// anything at or below it, so a captured code cannot be replayed inside its
// own window. Same window of +/- 1 step as verifyTotpCode.
export function totpStepForCode(secret, token, now = Date.now()) {
  if (!secret || !token || typeof token !== 'string') return null;
  const cleaned = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return null;
  const delta = buildTotp(secret).validate({ token: cleaned, window: 1, timestamp: now });
  if (delta === null) return null;
  return Math.floor(now / 30000) + delta;
}

// Ten single-use recovery codes, shown once at enrollment. Hashed the same
// way PINs are (scrypt + per-code salt) — never stored or logged in plain
// text after the enrollment response.
export function generateBackupCodes(count = 10) {
  const plain = [];
  const hashed = [];
  for (let i = 0; i < count; i++) {
    const code = randomBackupCode();
    const salt = genSalt();
    plain.push(code);
    hashed.push({ hash: hashPin(code, salt), salt, used_at: null });
  }
  return { plain, hashed };
}

function randomBackupCode() {
  // 10 chars from an unambiguous alphabet (no 0/O/1/I/L), grouped for
  // readability — matches the "write these down" UX these codes are for.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

// Checks `entered` against the stored backup_codes array and, if it
// matches an unused one, returns the updated array with that entry marked
// used — the caller is responsible for persisting it, so a code can never
// be reused once its consuming request succeeds. Returns { matched, codes }.
export function consumeBackupCode(entered, backupCodes) {
  const cleaned = String(entered || '').trim().toUpperCase();
  if (!cleaned || !Array.isArray(backupCodes)) return { matched: false, codes: backupCodes || [] };

  let matchedIndex = -1;
  for (let i = 0; i < backupCodes.length; i++) {
    const entry = backupCodes[i];
    if (entry.used_at) continue;
    const a = Buffer.from(hashPin(cleaned, entry.salt));
    const b = Buffer.from(String(entry.hash));
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      matchedIndex = i;
      break;
    }
  }
  if (matchedIndex === -1) return { matched: false, codes: backupCodes };

  const codes = backupCodes.map((entry, i) =>
    i === matchedIndex ? { ...entry, used_at: new Date().toISOString() } : entry
  );
  return { matched: true, codes };
}
