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
  withUnguessableSegment,
} = await import('../../server-lib/uploadUrls.js');
const { pathFromStoredUrl } = await import('../../server-lib/signedUrls.js');

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

test('a null expected company means "no company", not "skip the check"', () => {
  // Admin sessions carry companyId: null. Treating that as "don't verify"
  // silently degraded the check to bucket-only for them, so a tenant's
  // receipt could be replayed onto any record.
  const boundToA = signUploadReceipt('flha-reports', PATH, COMPANY_A);
  assert.equal(resolveUploadReceipt(boundToA, 'flha-reports', null), null);
  assert.equal(resolveUploadReceipt(boundToA, 'flha-reports', undefined), null);
  assert.equal(resolveUploadReceipt(boundToA, 'flha-reports'), null);

  // An admin's own unbound receipt still resolves for an admin.
  const unbound = signUploadReceipt('flha-reports', PATH);
  assert.equal(resolveUploadReceipt(unbound, 'flha-reports', null), PATH);
});

test('company ids compare as strings, so a numeric id and its text form match', () => {
  const receipt = signUploadReceipt('flha-reports', PATH, COMPANY_A);
  assert.equal(resolveUploadReceipt(receipt, 'flha-reports', String(COMPANY_A)), PATH);
  assert.equal(resolveUploadReceipt(receipt, 'flha-reports', COMPANY_A), PATH);
});


test('withUnguessableSegment randomizes the filename but keeps the directory prefix', () => {
  // api/certifications.js validates uploads with
  // `filePath.startsWith(`${companyId}/${rosterId}/`)`, so the random part
  // has to go in the last segment and nowhere else.
  const out = withUnguessableSegment('12/345/1757000000000-ticket.pdf');
  assert.ok(out.startsWith('12/345/'), out);
  assert.equal(out.split('/').length, 3);
  assert.match(out, /^12\/345\/[0-9a-f]{32}-1757000000000-ticket\.pdf$/);
});

test('withUnguessableSegment handles a flat path and never repeats itself', () => {
  const a = withUnguessableSegment('FLHA_Acme.pdf');
  const b = withUnguessableSegment('FLHA_Acme.pdf');
  assert.match(a, /^[0-9a-f]{32}-FLHA_Acme\.pdf$/);
  assert.notEqual(a, b);
});

test('pathFromStoredUrl refuses a path that escapes its bucket', () => {
  // The bucket name is not a boundary: Supabase builds
  // `object/sign/<bucket>/<path>` as a URL string and dot segments collapse
  // before the request goes out, so `../flha-reports/x.pdf` stored against
  // gatehouse-uploads would have signed a file in flha-reports.
  const escape = 'https://example.supabase.co/storage/v1/object/public/gatehouse-uploads/'
    + '../flha-reports/FLHA_Acme_2026-03-04T14-22-05.pdf';
  assert.equal(pathFromStoredUrl(escape, 'gatehouse-uploads'), null);

  for (const bad of ['../x.pdf', 'a/../../x.pdf', './x.pdf', 'a/./x.pdf', '/x.pdf']) {
    const url = `https://example.supabase.co/storage/v1/object/public/flha-reports/${bad}`;
    assert.equal(pathFromStoredUrl(url, 'flha-reports'), null, bad);
  }
});

test('pathFromStoredUrl still resolves a normal path', () => {
  const url = `https://example.supabase.co/storage/v1/object/public/flha-reports/${PATH}`;
  assert.equal(pathFromStoredUrl(url, 'flha-reports'), PATH);
  const nested = 'https://example.supabase.co/storage/v1/object/public/worker-certifications/12/345/abc-t.pdf';
  assert.equal(pathFromStoredUrl(nested, 'worker-certifications'), '12/345/abc-t.pdf');
});
