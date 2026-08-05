// server-lib/signedUrls.js
// Batched signed-URL generation for list endpoints. Every list handler in
// this app re-signs stored URLs per row before returning them (flha-reports,
// signatures, and incident-photos are private buckets — see the comment in
// api/reports.js), which used to mean one createSignedUrl() Storage API call
// per row, per URL field — a real network round-trip each, not free even
// when awaited in parallel via Promise.all. createSignedUrls() batches many
// paths from the same bucket into a single call, so a list of 500 rows with
// one pdf_url each costs one extra round-trip instead of 500.

export function pathFromStoredUrl(url, bucket) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

// fields: [{ key, bucket }] — which row property holds a stored URL (or an
// array of them, e.g. photo_urls) and which bucket it lives in. Returns new
// row objects with each field replaced by its signed URL(s).
export async function signRows(supabaseAdmin, rows, fields, ttlSeconds = 3600) {
  if (!rows || rows.length === 0) return rows || [];

  const pathsByBucket = new Map();
  for (const { key, bucket } of fields) {
    if (!pathsByBucket.has(bucket)) pathsByBucket.set(bucket, new Set());
    const set = pathsByBucket.get(bucket);
    for (const row of rows) {
      const value = row[key];
      const values = Array.isArray(value) ? value : [value];
      for (const url of values) {
        const path = pathFromStoredUrl(url, bucket);
        if (path) set.add(path);
      }
    }
  }

  const signedByBucket = new Map();
  await Promise.all([...pathsByBucket.entries()].map(async ([bucket, pathSet]) => {
    const paths = [...pathSet];
    const map = new Map();
    signedByBucket.set(bucket, map);
    if (paths.length === 0) return;
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrls(paths, ttlSeconds);
    if (error || !data) return;
    data.forEach(d => { if (!d.error) map.set(d.path, d.signedUrl); });
  }));

  const resolve = (url, bucket) => {
    const path = pathFromStoredUrl(url, bucket);
    return path ? (signedByBucket.get(bucket).get(path) || null) : null;
  };

  return rows.map(row => {
    const out = { ...row };
    for (const { key, bucket } of fields) {
      const value = row[key];
      out[key] = Array.isArray(value) ? value.map(u => resolve(u, bucket)) : resolve(value, bucket);
    }
    return out;
  });
}
