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

export async function createUploadUrl(supabaseAdmin, bucket, filename) {
  const clean = sanitizeFilename(filename);
  if (!clean) return { error: 'Invalid filename.' };
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(clean);
  if (error) return { error: error.message || 'Could not prepare the upload.' };
  return { path: data.path, uploadToken: data.token };
}
