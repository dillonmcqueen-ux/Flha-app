// src/uploadViaSignedUrl.js
// Every file upload in this app goes through here. See the matching note
// in server-lib/uploadUrls.js: a direct browser upload with the anon key
// fails Postgres RLS (no SELECT policy on storage.objects to satisfy the
// INSERT ... RETURNING that .upload() performs), so instead we ask the
// relevant api/*.js endpoint for a short-lived signed upload token
// (service-role key, bypasses RLS) and upload straight to Storage with
// that token.
import { supabase } from "./supabaseClient.js";

export async function uploadViaSignedUrl({ endpoint, action, token, bucket, filename, file, contentType, extra = {} }) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, token, bucket, filename, ...extra }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't prepare the upload.");

  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(data.path, data.uploadToken, file, { contentType });
  if (error) throw new Error(error.message || "Upload failed.");

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(data.path);
  // Spread the endpoint's response first so any extra fields it returns
  // pass through to the caller untouched, alongside the two fields every
  // caller already expects. Two callers rely on this:
  //   - `receipt` — server-lib/uploadUrls.js's signed statement that this
  //     server issued this path. The PDF generators return it instead of
  //     `publicUrl`, and the endpoint that stores it swaps it back for the
  //     real path, so a caller can never name a storage path of its own.
  //   - `pathToken` — api/login.js's older, onboarding-uploads-only version
  //     of the same idea.
  return { ...data, path: data.path, publicUrl: pub?.publicUrl || "" };
}
