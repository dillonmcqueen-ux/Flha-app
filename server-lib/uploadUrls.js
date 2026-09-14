// server-lib/uploadUrls.js
// Shared signed-upload-URL issuing for storage.objects. No bucket in this
// project has a SELECT policy, which breaks a direct browser upload with
// the anon key, since supabase-js's .upload() does an INSERT ... RETURNING
// under the hood and Postgres RLS requires the returned row to also pass a
// SELECT policy. Rather than reopening SELECT (which would let anyone
// .list() and enumerate every file in these buckets), every upload flow
// instead asks
// its api/*.js endpoint for a short-lived signed upload token — issued
// here with the service-role key, which bypasses RLS entirely — and the
// browser uploads straight to Storage with that token via
// uploadToSignedUrl(). Lives outside api/ on purpose: Vercel only turns
// files directly under api/ into functions, and this is imported by
// several of them.

// On INSERT policies specifically: as of 2026-09-14 only company-logos still
// carries one (PUBLIC, so that bucket still accepts an unauthenticated
// write). signatures, incident-photos, onboarding-uploads and flha-reports
// had theirs dropped — see docs/schema/drop-anon-storage-insert-policies.sql.
// An earlier version of this comment claimed a direct anon .upload() would
// fail RLS everywhere; that was not true, which is how src/generatePDF.js
// uploaded FLHA PDFs with the anon key for months. That file is now on this
// module like every other caller, so nothing in the codebase depends on an
// anon INSERT policy any more.

import crypto from 'crypto';

// Every issued path gets an unguessable component spliced into its final
// segment. Before this, paths were fully determined by the caller-supplied
// filename — src/generatePDF.js builds `{Company}_{Worker}_{ISO-to-the-
// second}.pdf` — which made them guessable by anyone who knew a target
// company and worker. That mattered because pdf_url is stored on the record
// and every list endpoint signs whatever path it finds there, so a guessed
// path was a readable document. The random segment is spliced into the last
// segment rather than prepended to the whole path so callers that namespace
// by directory (api/certifications.js's `${companyId}/${rosterId}/...`, and
// the `startsWith` prefix checks built on it) keep their structure intact.
function withUnguessableSegment(path) {
  const segments = path.split('/');
  const name = segments.pop();
  segments.push(`${crypto.randomBytes(16).toString('hex')}-${name}`);
  return segments.join('/');
}

// Hash-then-compare so mismatched-length inputs never short-circuit, same
// helper shape as api/*.js's session verification.
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

// ── Upload receipts ───────────────────────────────────────────────────
// A receipt is an opaque, HMAC-signed statement by this server that it
// issued <path> in <bucket>. createUploadUrl hands one back alongside the
// upload token; the browser passes it through untouched in place of the
// URL it used to build itself, and the write endpoints swap it for the
// stored URL via storedUrlForReceipt().
//
// The problem this solves: pdf_url was raw client input. A worker could put
// ANOTHER company's flha-reports path on their own record, and every list
// endpoint would sign it for them on read (server-lib/signedUrls.js's
// pathFromStoredUrl parses the path straight out of the stored string), so
// they'd get a working link to a document they can't otherwise see. Because
// a receipt can only come from this server, a path that was never issued to
// this caller can't be stored at all — which also protects the documents
// already sitting in the bucket under old, guessable names.
//
// Same construction as api/login.js's signSopPathToken, which has done this
// for onboarding-uploads since that flow was built; this generalizes it so
// every bucket can use it. Signed with SESSION_SECRET, which only lives in
// Vercel's settings.
export function signUploadReceipt(bucket, path, companyId = null) {
  const claim = { b: bucket, p: path };
  if (companyId !== null && companyId !== undefined) claim.c = String(companyId);
  const data = Buffer.from(JSON.stringify(claim)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(`upload-receipt:${data}`).digest('base64url');
  return `${data}.${sig}`;
}

// Returns the issued path, or null if the receipt is missing, tampered
// with, or was issued for a different bucket. base64url never contains a
// ".", so the first one is unambiguously the separator.
//
// Pass `expectedCompanyId` to also require that the receipt was issued to
// that company. This is fail-closed: a receipt minted without a company
// (the pre-auth onboarding flow, which has no session yet) never satisfies
// a caller that asks for one. It closes replay — without it, a receipt is
// a bearer statement that *someone* was issued this path, so one that
// leaked out of another tenant's browser would still resolve.
export function resolveUploadReceipt(receipt, expectedBucket, expectedCompanyId = null) {
  if (!receipt || typeof receipt !== 'string') return null;
  const idx = receipt.indexOf('.');
  if (idx <= 0 || idx === receipt.length - 1) return null;
  const data = receipt.slice(0, idx);
  const sig = receipt.slice(idx + 1);
  const expected = crypto.createHmac('sha256', process.env.SESSION_SECRET)
    .update(`upload-receipt:${data}`).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(data, 'base64url').toString()); } catch (e) { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (payload.b !== expectedBucket) return null;
  if (typeof payload.p !== 'string' || !payload.p) return null;
  if (expectedCompanyId !== null && expectedCompanyId !== undefined
      && payload.c !== String(expectedCompanyId)) return null;
  return payload.p;
}

// The stored-column value for a verified receipt. Deliberately the same
// "public"-shaped string the browser used to build with getPublicUrl(), so
// every existing reader (pathFromStoredUrl in server-lib/signedUrls.js and
// the per-file copies in api/*.js) keeps working unchanged and rows written
// before this existed still resolve. sanitizeFilename() leaves only
// [A-Za-z0-9_.-] and "/", so no segment needs percent-encoding and the
// string round-trips through decodeURIComponent() intact.
export function storedUrlForReceipt(receipt, expectedBucket, expectedCompanyId = null) {
  const path = resolveUploadReceipt(receipt, expectedBucket, expectedCompanyId);
  if (!path) return null;
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${expectedBucket}/${path}`;
}

// What the api/*.js write paths actually call. Takes whatever the client
// put in a pdf_url-shaped field and returns the URL to store, or null if it
// isn't a receipt this server issued. Dropping to null rather than 400ing
// is deliberate: PDF generation already returns null on failure and every
// form tolerates a record with no PDF link, whereas rejecting the request
// would throw away a worker's finished safety document in the field.
export function storedUrlFromClientReceipt(value, companyId, bucket = 'flha-reports') {
  if (!value) return null;
  const url = storedUrlForReceipt(value, bucket, companyId);
  if (!url) console.error(`Dropped a ${bucket} URL that was not a valid upload receipt for this company.`);
  return url;
}

// Sanitizes each path segment independently rather than the whole string,
// so callers that need a per-tenant subpath (e.g. `${companyId}/${rosterId}/
// ${filename}` in api/certifications.js) keep their directory structure —
// a single blanket regex would strip every "/" and silently flatten the
// path, breaking any prefix check built on it. Empty/"."/".." segments are
// dropped so this can't be used for path traversal or a leading slash.
function sanitizeFilename(name) {
  return String(name || '')
    .split('/')
    .map((segment) => segment.replace(/[^a-zA-Z0-9_.\-]/g, ''))
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}

// Extension allow-list per bucket, matching the file types each upload flow
// actually produces (see the `accept` attributes in the matching src/*.jsx
// forms and the hardcoded contentType each PDF generator uploads with).
// This is defense-in-depth on top of the bucket-level allowed_mime_types/
// file_size_limit set directly on each storage.buckets row (the actual
// upload PUT goes straight from the browser to Supabase Storage with this
// signed token, bypassing this server entirely, so that bucket-level config
// is the authoritative content-type/size gate) — this extension check just
// stops an obviously-wrong file (e.g. a company logo named "x.html") from
// ever getting a signed path issued for it in the first place.
const ALLOWED_EXTENSIONS = {
  'company-logos': ['png', 'jpg', 'jpeg', 'webp'],
  'flha-reports': ['pdf'],
  'incident-photos': ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
  'signatures': ['png'],
  'onboarding-uploads': ['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg'],
  'gatehouse-uploads': ['jpg', 'jpeg', 'png', 'webp'],
  'worker-certifications': ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
  'worker-photos': ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
};

// `companyId` binds the issued receipt to the caller's tenant. Callers that
// have a session should always pass it; the pre-auth onboarding upload in
// api/login.js is the one that legitimately can't (it has its own,
// older pathToken mechanism instead).
export async function createUploadUrl(supabaseAdmin, bucket, filename, companyId = null) {
  const clean = sanitizeFilename(filename);
  if (!clean) return { error: 'Invalid filename.' };
  const allowed = ALLOWED_EXTENSIONS[bucket];
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  if (allowed && !allowed.includes(ext)) {
    return { error: `Unsupported file type for this upload (.${ext || 'none'}).` };
  }
  const { data, error } = await supabaseAdmin.storage
    .from(bucket).createSignedUploadUrl(withUnguessableSegment(clean));
  if (error) return { error: error.message || 'Could not prepare the upload.' };
  // `receipt` is returned for every bucket so any flow can adopt it; only
  // the flha-reports write paths verify one today (see the module comment).
  return {
    path: data.path,
    uploadToken: data.token,
    receipt: signUploadReceipt(bucket, data.path, companyId),
  };
}
