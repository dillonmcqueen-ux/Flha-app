// server-lib/documentEngine/links.js
// Short-lived signed links for the files on one engine record: its PDF, its
// signature images and its file answers. Every bucket involved is private, so
// nothing is handed out without a signature, and nothing is signed unless the
// stored path is inside the company's own folder (issued paths always start
// with `<companyId>/`, see createUploadUrl). Pure except for signTargets,
// which takes the storage client as an argument.

export const LINK_TTL_SECONDS = 300;

const BUCKET = { pdf: 'flha-reports', signature: 'signatures', attachment: 'portal-attachments' };

/** True when `path` is a plain relative path inside this company's folder. */
export function pathInCompany(path, companyId) {
  if (typeof path !== 'string' || path === '' || path.startsWith('/')) return false;
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false;
  return parts[0] === String(companyId) && parts.length >= 2;
}

/** What to sign for a record: [{ id, bucket, path }]. Paths outside the company are dropped. */
export function linkTargets({ companyId, record, answers, signatures }) {
  const out = [];
  const add = (id, bucket, path) => { if (pathInCompany(path, companyId)) out.push({ id, bucket, path }); };
  add('pdf', BUCKET.pdf, record && record.pdf_path);
  for (const s of signatures || []) add(`sig:${s.id}`, BUCKET.signature, s.signature_path);
  for (const a of answers || []) add(`file:${a.id}`, a.field_type === 'signature' ? BUCKET.signature : BUCKET.attachment, a.file_path);
  return out;
}

/** Signs the targets, one storage call per bucket. Returns Map(id -> url); a failure leaves that link out. */
export async function signTargets(supabaseAdmin, targets, ttl = LINK_TTL_SECONDS) {
  const urls = new Map();
  const byBucket = new Map();
  for (const t of targets) {
    if (!byBucket.has(t.bucket)) byBucket.set(t.bucket, []);
    byBucket.get(t.bucket).push(t);
  }
  await Promise.all([...byBucket.entries()].map(async ([bucket, list]) => {
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrls(list.map((t) => t.path), ttl);
    if (error || !data) return;
    const byPath = new Map(data.filter((d) => !d.error && d.signedUrl).map((d) => [d.path, d.signedUrl]));
    for (const t of list) if (byPath.has(t.path)) urls.set(t.id, byPath.get(t.path));
  }));
  return urls;
}
