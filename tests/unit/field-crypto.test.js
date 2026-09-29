import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptField, decryptField, isEncrypted, withDecryptedEmail } from '../../server-lib/fieldCrypto.js';

const KEY = crypto.randomBytes(32).toString('base64');
const withKey = (key, fn) => {
  const prev = process.env.FIELD_ENCRYPTION_KEY;
  if (key === undefined) delete process.env.FIELD_ENCRYPTION_KEY; else process.env.FIELD_ENCRYPTION_KEY = key;
  try { return fn(); } finally { if (prev === undefined) delete process.env.FIELD_ENCRYPTION_KEY; else process.env.FIELD_ENCRYPTION_KEY = prev; }
};

test('round trips and never stores the plaintext', () => withKey(KEY, () => {
  const enc = encryptField('mike@example.com');
  assert.ok(isEncrypted(enc));
  assert.ok(!enc.includes('mike'));
  assert.equal(decryptField(enc), 'mike@example.com');
}));

test('same value encrypts differently each time (random IV)', () => withKey(KEY, () => {
  assert.notEqual(encryptField('a@b.co'), encryptField('a@b.co'));
}));

test('null and empty stay null, legacy plaintext passes through', () => withKey(KEY, () => {
  assert.equal(encryptField(null), null);
  assert.equal(encryptField(''), '');
  assert.equal(decryptField('old@plain.com'), 'old@plain.com');
  assert.equal(decryptField(null), null);
}));

test('does not double-encrypt', () => withKey(KEY, () => {
  const enc = encryptField('a@b.co');
  assert.equal(encryptField(enc), enc);
}));

test('fails closed without a valid key', () => {
  withKey(undefined, () => assert.throws(() => encryptField('a@b.co')));
  withKey('short', () => assert.throws(() => encryptField('a@b.co')));
});

test('tampering or the wrong key is rejected', () => {
  const enc = withKey(KEY, () => encryptField('a@b.co'));
  withKey(crypto.randomBytes(32).toString('base64'), () => assert.throws(() => decryptField(enc)));
  withKey(KEY, () => assert.throws(() => decryptField(enc.slice(0, -2) + 'AA')));
});

test('withDecryptedEmail handles rows, lists, and a bad row without throwing', () => withKey(KEY, () => {
  const enc = encryptField('a@b.co');
  assert.equal(withDecryptedEmail({ id: 1, email: enc }).email, 'a@b.co');
  assert.deepEqual(withDecryptedEmail([{ email: enc }, { email: null }]).map((r) => r.email), ['a@b.co', null]);
  const origErr = console.error; console.error = () => {};
  try { assert.equal(withDecryptedEmail({ email: 'enc:v1:x:y:z' }).email, null); } finally { console.error = origErr; }
  assert.deepEqual(withDecryptedEmail({ id: 2 }), { id: 2 });
}));
