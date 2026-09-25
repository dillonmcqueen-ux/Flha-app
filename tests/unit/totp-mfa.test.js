import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as OTPAuth from 'otpauth';
import {
  generateTotpSecret,
  totpEnrollmentUri,
  verifyTotpCode,
  generateBackupCodes,
  consumeBackupCode,
} from '../../server-lib/totp.js';

test('generateTotpSecret returns a usable base32 secret', () => {
  const secret = generateTotpSecret();
  assert.equal(typeof secret, 'string');
  assert.ok(secret.length > 0);
  assert.doesNotThrow(() => OTPAuth.Secret.fromBase32(secret));
});

test('totpEnrollmentUri embeds the issuer and secret', () => {
  const secret = generateTotpSecret();
  const uri = totpEnrollmentUri(secret);
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /issuer=FORA/);
});

test('verifyTotpCode accepts the current code and rejects a wrong one', () => {
  const secret = generateTotpSecret();
  const totp = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  const code = totp.generate();

  assert.equal(verifyTotpCode(secret, code), true);
  assert.equal(verifyTotpCode(secret, '000000'), code === '000000');
  assert.equal(verifyTotpCode(secret, 'not-a-code'), false);
  assert.equal(verifyTotpCode(secret, ''), false);
  assert.equal(verifyTotpCode(secret, null), false);
});

test('generateBackupCodes returns 10 unique plain codes with matching hashed entries', () => {
  const { plain, hashed } = generateBackupCodes();
  assert.equal(plain.length, 10);
  assert.equal(hashed.length, 10);
  assert.equal(new Set(plain).size, 10);
  for (const entry of hashed) {
    assert.equal(entry.used_at, null);
    assert.equal(typeof entry.hash, 'string');
    assert.equal(typeof entry.salt, 'string');
  }
});

test('consumeBackupCode matches an unused code once, then rejects reuse', () => {
  const { plain, hashed } = generateBackupCodes();
  const target = plain[3];

  const first = consumeBackupCode(target, hashed);
  assert.equal(first.matched, true);
  assert.ok(first.codes[3].used_at);

  const second = consumeBackupCode(target, first.codes);
  assert.equal(second.matched, false);
});

test('consumeBackupCode is case-insensitive and rejects an unknown code', () => {
  const { plain, hashed } = generateBackupCodes();
  const lower = consumeBackupCode(plain[0].toLowerCase(), hashed);
  assert.equal(lower.matched, true);

  const unknown = consumeBackupCode('ZZZZZ-ZZZZZ', hashed);
  assert.equal(unknown.matched, false);
});
