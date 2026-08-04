// src/uploadViaSignedUrl.js
// Every file upload in this app goes through here. See the matching note
// in server-lib/uploadUrls.js: a direct browser upload with the anon key
// fails Postgres RLS (no SELECT policy on storage.objects to satisfy the
// INSERT ... RETURNING that .upload() performs), so instead we ask the
// relevant api/*.js endpoint for a short-lived signed upload token
// (service-role key, bypasses RLS) and upload straight to Storage with
// that token.
import { supabase } from "./supabaseClient.js";

export async function uploadViaSignedUrl({ endpoint, action, token, bucket, filename, file, contentType }) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, token, bucket, filename }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't prepare the upload.");

  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(data.path, data.uploadToken, file, { contentType });
  if (error) throw new Error(error.message || "Upload failed.");

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return { path: data.path, publicUrl: pub?.publicUrl || "" };
}
