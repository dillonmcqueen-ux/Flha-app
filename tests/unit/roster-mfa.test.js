import test from 'node:test';
import assert from 'node:assert/strict';
import * as OTPAuth from 'otpauth';
import { requiresMfa, mfaStatus, canResetMfa } from '../../server-lib/rosterMfa.js';
import { generateTotpSecret, totpStepForCode, generateBackupCodes, consumeBackupCode } from '../../server-lib/totp.js';

test('supervisors and sensitive departments must use an authenticator', () => {
  assert.equal(requiresMfa({ role: 'supervisor', departments: [] }), true);
  assert.equal(requiresMfa({ role: 'worker', departments: ['safety'] }), true);
  assert.equal(requiresMfa({ role: 'worker', departments: ['hr'] }), true);
  assert.equal(requiresMfa({ role: 'worker', departments: ['payroll'] }), true);
  assert.equal(requiresMfa({ role: 'worker', departments: ['maintenance'] }), false);
  assert.equal(requiresMfa({ role: 'worker', departments: null }), false);
  assert.equal(requiresMfa(null), false);
});

test('status never carries the secret or backup codes', () => {
  const s = mfaStatus({ role: 'worker', totp_enabled: true, totp_secret: 'enc:v1:x', totp_backup_codes: [{ hash: 'h' }] });
  assert.deepEqual(Object.keys(s).sort(), ['enabled', 'required']);
});

test('reset pyramid: founder > owner > supervisor > worker, never yourself', () => {
  const founder = { role: 'admin' };
  const sup = { role: 'supervisor', userId: 2, companyId: 10 };
  const owner = { role: 'owner', userId: 3, companyId: 10 };
  const worker = { id: 9, role: 'worker', company_id: 10 };
  const otherSup = { id: 8, role: 'supervisor', company_id: 10 };

  assert.equal(canResetMfa(founder, otherSup), true);
  assert.equal(canResetMfa(sup, worker), true);
  assert.equal(canResetMfa(sup, otherSup), false); // supervisors cannot reset supervisors
  assert.equal(canResetMfa(owner, otherSup), true);
  assert.equal(canResetMfa(owner, worker), true);
  assert.equal(canResetMfa(sup, { ...worker, company_id: 11 }), false); // other company
  assert.equal(canResetMfa(sup, { id: 2, role: 'worker', company_id: 10 }), false); // self
  assert.equal(canResetMfa({ role: 'worker', userId: 5, companyId: 10 }, worker), false);
  // A company roster row with role 'admin' is not the founder.
  assert.equal(canResetMfa({ role: 'admin', userId: 7, companyId: 10 }, worker), false);
});

test('a code maps to its time step, so a used step can be refused', () => {
  const secret = generateTotpSecret();
  const totp = new OTPAuth.TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  const now = Date.now();
  const code = totp.generate({ timestamp: now });
  assert.equal(totpStepForCode(secret, code, now), Math.floor(now / 30000));
  assert.equal(totpStepForCode(secret, '000000', now) === null || totpStepForCode(secret, '000000', now) >= 0, true);
  assert.equal(totpStepForCode(secret, 'abc', now), null);
  assert.equal(totpStepForCode(null, code, now), null);
});

test('backup codes are single use and well formed', () => {
  const { plain, hashed } = generateBackupCodes(10);
  assert.equal(plain.length, 10);
  assert.equal(new Set(plain).size, 10);
  for (const c of plain) assert.match(c, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  const first = consumeBackupCode(plain[0], hashed);
  assert.equal(first.matched, true);
  const again = consumeBackupCode(plain[0], first.codes);
  assert.equal(again.matched, false);
  assert.equal(consumeBackupCode('WRONG-CODES', hashed).matched, false);
});
