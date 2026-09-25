// Tests that createUploadUrl (server-lib/uploadUrls.js) namespaces the
// issued path under `<companyId>/` when a companyId is given, and leaves
// it unprefixed when it isn't — see the comment above createUploadUrl for
// why (docs/security/data-retention-policy.md's per-company purge, and
// TODO.md's "Namespace Supabase Storage objects by company").
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET ||= 'test-session-secret';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';

const { createUploadUrl } = await import('../../server-lib/uploadUrls.js');

// A minimal stand-in for the real Supabase client: captures the path
// createUploadUrl asked Storage to sign, without any network call.
function fakeSupabase() {
  let capturedPath = null;
  const client = {
    storage: {
      from(bucket) {
        return {
          createSignedUploadUrl(path) {
            capturedPath = path;
            return Promise.resolve({ data: { path, token: 'fake-token' }, error: null });
          },
        };
      },
    },
  };
  return { client, getPath: () => capturedPath };
}

test('a companyId prefixes the issued path with <companyId>/', async () => {
  const { client, getPath } = fakeSupabase();
  const result = await createUploadUrl(client, 'flha-reports', 'FLHA_Acme_2026-09-25.pdf', 7);
  assert.equal(result.error, undefined);
  assert.match(getPath(), /^7\/[0-9a-f]{32}-FLHA_Acme_2026-09-25\.pdf$/);
  assert.equal(result.path, getPath());
});

test('no companyId leaves the path unprefixed, unchanged from before', async () => {
  const { client, getPath } = fakeSupabase();
  const result = await createUploadUrl(client, 'company-logos', 'logo.png');
  assert.equal(result.error, undefined);
  assert.match(getPath(), /^[0-9a-f]{32}-logo\.png$/);
});

test('companyId 0 still prefixes (falsy is not "absent")', async () => {
  const { client, getPath } = fakeSupabase();
  await createUploadUrl(client, 'flha-reports', 'x.pdf', 0);
  assert.match(getPath(), /^0\/[0-9a-f]{32}-x\.pdf$/);
});

test('a pre-namespaced filename (api/certifications.js style) is untouched by the companyId prefix when companyId is omitted', async () => {
  const { client, getPath } = fakeSupabase();
  await createUploadUrl(client, 'worker-certifications', '7/42/1758808000000-cert.pdf');
  assert.match(getPath(), /^7\/42\/[0-9a-f]{32}-1758808000000-cert\.pdf$/);
});
