// server-lib/uploadUrls.js
// Shared signed-upload-URL issuing for storage.objects. None of this
// project's storage buckets have a SELECT policy, only INSERT — which
// breaks a direct browser upload with the anon key, since supabase-js's
// .upload() does an INSERT ... RETURNING under the hood, and Postgres RLS
// requires the returned row to also pass a SELECT policy. Rather than
// reopening SELECT (which would let anyone .list() and enumerate every
// file in these public/private buckets), every upload flow instead asks
// its api/*.js endpoint for a short-lived signed upload token — issued
// here with the service-role key, which bypasses RLS entirely — and the
// browser uploads straight to Storage with that token via
// uploadToSignedUrl(). Lives outside api/ on purpose: Vercel only turns
// files directly under api/ into functions, and this is imported by
// several of them.

function sanitizeFilename(name) {
  return String(name || '').replace(/[^a-zA-Z0-9_.\-]/g, '');
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
};

export async function createUploadUrl(supabaseAdmin, bucket, filename) {
  const clean = sanitizeFilename(filename);
  if (!clean) return { error: 'Invalid filename.' };
  const allowed = ALLOWED_EXTENSIONS[bucket];
  const ext = clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  if (allowed && !allowed.includes(ext)) {
    return { error: `Unsupported file type for this upload (.${ext || 'none'}).` };
  }
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(clean);
  if (error) return { error: error.message || 'Could not prepare the upload.' };
  return { path: data.path, uploadToken: data.token };
}
