// createUploadUrl caps how many signed upload slots one company is issued per
// hour, and a broken counter never blocks an upload.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-session-secret-for-signing-only';

const { createUploadUrl, UPLOAD_SLOTS_MAX_PER_COMPANY_PER_HOUR } = await import('../../server-lib/uploadUrls.js');

function fakeSupabase({ count, rpcThrows = false } = {}) {
  const calls = [];
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args });
      if (rpcThrows) throw new Error('rpc down');
      return Promise.resolve({ data: count, error: null });
    },
    storage: { from: () => ({ createSignedUploadUrl: async (path) => ({ data: { path, token: 't' }, error: null }) }) },
  };
}

test('the limit is 2000 slots per company per hour', () => {
  assert.equal(UPLOAD_SLOTS_MAX_PER_COMPANY_PER_HOUR, 2000);
});

test('a slot under the limit is issued and counted against the company', async () => {
  const db = fakeSupabase({ count: 5 });
  const out = await createUploadUrl(db, 'flha-reports', 'doc.pdf', 42);
  assert.ok(out.uploadToken, JSON.stringify(out));
  assert.equal(db.calls[0].name, 'bump_ip_throttle');
  assert.equal(db.calls[0].args.p_key, 'upslot:42');
  assert.equal(db.calls[0].args.p_window_seconds, 3600);
});

test('the 2001st slot in an hour is refused', async () => {
  const out = await createUploadUrl(fakeSupabase({ count: 2001 }), 'flha-reports', 'doc.pdf', 42);
  assert.equal(out.rateLimited, true);
  assert.match(out.error, /Too many uploads/);
  assert.equal(out.uploadToken, undefined);
});

test('the 2000th slot is still issued', async () => {
  const out = await createUploadUrl(fakeSupabase({ count: 2000 }), 'flha-reports', 'doc.pdf', 42);
  assert.ok(out.uploadToken);
});

test('a caller that builds its own prefix counts against the company through rateKey', async () => {
  const db = fakeSupabase({ count: 1 });
  await createUploadUrl(db, 'worker-certifications', '42/7/1-ticket.pdf', null, 42);
  assert.equal(db.calls[0].args.p_key, 'upslot:42');
});

test('callers with no company are not counted here', async () => {
  const db = fakeSupabase({ count: 1 });
  await createUploadUrl(db, 'company-logos', 'logo.png');
  assert.equal(db.calls.length, 0);
});

test('a broken counter lets the upload through', async () => {
  const out = await createUploadUrl(fakeSupabase({ rpcThrows: true }), 'flha-reports', 'doc.pdf', 42);
  assert.ok(out.uploadToken, JSON.stringify(out));
});
