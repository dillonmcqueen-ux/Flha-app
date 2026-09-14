// Tests for the upload-receipt binding in server-lib/uploadUrls.js.
//
// Before receipts, `pdf_url` was raw client input: a worker could store
// another company's flha-reports path on their own record, and any list
// endpoint would hand back a signed URL for it on read (see
// server-lib/signedUrls.js's pathFromStoredUrl). A receipt is an HMAC over
// (bucket, path) that only this server can produce, so a path it never
// issued can't be stored at all.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET ||= 'test-session-secret';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';

const {
  signUploadReceipt, resolveUploadReceipt, storedUrlForReceipt, storedUrlFromClientReceipt,
} = await import('../../server-lib/uploadUrls.js');

const PATH = 'deadbeefdeadbeefdeadbeefdeadbeef-FLHA_Acme_2026-09-10T14-22-05.pdf';
const COMPANY_A = 7;
const COMPANY_B = 9;

test('a receipt this server issued round-trips back to its path', () => {
  const receipt = signUploadReceipt('flha-reports', PATH);
  assert.equal(resolveUploadReceipt(receipt, 'flha-reports'), PATH);
});

test('a receipt is rejected for a bucket it was not issued for', () => {
  const receipt = signUploadReceipt('incident-photos', PATH);
  assert.equal(resolveUploadReceipt(receipt, 'flha-reports'), null);
});

test('tampering with the payload invalidates the signature', () => {
  const receipt = signUploadReceipt('flha-reports', PATH);
  const [, sig] = receipt.split('.');
  const forged = Buffer.from(JSON.stringify({ b: 'flha-reports', p: 'FLHA_OtherCo_2026-09-10T14-22-05.pdf' }))
    .toString('base64url');
  assert.equal(resolveUploadReceipt(`${forged}.${sig}`, 'flha-reports'), null);
});

test('a raw storage path or public URL is not a receipt', () => {
  // The exact shape the browser used to build and submit as pdf_url.
  const publicUrl = `https://example.supabase.co/storage/v1/object/public/flha-reports/${PATH}`;
  assert.equal(resolveUploadReceipt(publicUrl, 'flha-reports'), null);
  assert.equal(resolveUploadReceipt(PATH, 'flha-reports'), null);
});

test('malformed receipts are rejected rather than throwing', () => {
  for (const bad of [null, undefined, '', '.', 'nodot', 'a.', '.b', 42, {}, 'not.base64url!!']) {
    assert.equal(resolveUploadReceipt(bad, 'flha-reports'), null, JSON.stringify(bad));
  }
});

test('storedUrlForReceipt produces the public-shaped string existing readers parse', () => {
  const receipt = signUploadReceipt('flha-reports', PATH);
  assert.equal(
    storedUrlForReceipt(receipt, 'flha-reports'),
    `https://example.supabase.co/storage/v1/object/public/flha-reports/${PATH}`
  );
});

test('the stored string round-trips through the reader that signs it', async () => {
  const { pathFromStoredUrl } = await import('../../server-lib/signedUrls.js');
  const stored = storedUrlForReceipt(signUploadReceipt('flha-reports', PATH), 'flha-reports');
  assert.equal(pathFromStoredUrl(stored, 'flha-reports'), PATH);
});

test('storedUrlFromClientReceipt drops anything that is not a receipt', () => {
  // This is the original bug: the browser used to build and submit exactly
  // this string, so any path could be named.
  const attackerPath = 'FLHA_OtherCompany_2026-09-10T14-22-05.pdf';
  const attackerUrl = `https://example.supabase.co/storage/v1/object/public/flha-reports/${attackerPath}`;
  assert.equal(storedUrlFromClientReceipt(attackerUrl, COMPANY_A), null);
  assert.equal(storedUrlFromClientReceipt(attackerPath, COMPANY_A), null);
  assert.equal(storedUrlFromClientReceipt(null, COMPANY_A), null);
  assert.equal(storedUrlFromClientReceipt(undefined, COMPANY_A), null);
});

test('storedUrlFromClientReceipt passes a genuine receipt through', () => {
  const receipt = signUploadReceipt('flha-reports', PATH, COMPANY_A);
  assert.equal(
    storedUrlFromClientReceipt(receipt, COMPANY_A),
    `https://example.supabase.co/storage/v1/object/public/flha-reports/${PATH}`
  );
});

test('a receipt issued to one company cannot be replayed by another', () => {
  const receipt = signUploadReceipt('flha-reports', PATH, COMPANY_A);
  assert.equal(resolveUploadReceipt(receipt, 'flha-reports', COMPANY_B), null);
  assert.equal(storedUrlFromClientReceipt(receipt, COMPANY_B), null);
});

test('company binding is fail-closed: an unbound receipt never satisfies a bound check', () => {
  const unbound = signUploadReceipt('flha-reports', PATH);
  assert.equal(resolveUploadReceipt(unbound, 'flha-reports'), PATH);
  assert.equal(resolveUploadReceipt(unbound, 'flha-reports', COMPANY_A), null);
});

test('company ids compare as strings, so a numeric id and its text form match', () => {
  const receipt = signUploadReceipt('flha-reports', PATH, COMPANY_A);
  assert.equal(resolveUploadReceipt(receipt, 'flha-reports', String(COMPANY_A)), PATH);
  assert.equal(resolveUploadReceipt(receipt, 'flha-reports', COMPANY_A), PATH);
});
