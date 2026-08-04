// api/reports.js
// Handles Incident and Near Miss reports — submitting, viewing, reviewing,
// and deleting — all with the same session checks as api/flhas.js. One file
// covers both report types since they work the same way.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { createUploadUrl } from '../server-lib/uploadUrls.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (sig !== expectedSig) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch (e) {
    return null;
  }
  if (!payload.issuedAt || Date.now() - payload.issuedAt > SESSION_TTL_MS) return null;

  // Admin sessions and legacy (pre-cutover) worker/supervisor sessions carry
  // no userId — nothing to live-check beyond the signature+TTL above.
  if (payload.role === 'admin' || !payload.userId) return payload;

  // Individually-identified (roster) sessions: re-check `active` on every
  // request, so deactivating someone takes effect on their very next call
  // instead of waiting out the token's TTL.
  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('active, role, company_id')
    .eq('id', payload.userId)
    .limit(1);
  if (error || !rows || rows.length === 0 || !rows[0].active) return null;
  if (rows[0].company_id !== payload.companyId) return null;
  return { ...payload, role: rows[0].role };
}

// flha-reports/signatures/incident-photos are private buckets — the DB
// still stores a "public"-shaped URL (upload code never changed), but that
// string is never itself a working link. Every value handed to a client is
// swapped for a short-lived signed URL first.
function pathFromStoredUrl(url, bucket) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

async function signStoredUrl(url, bucket, ttlSeconds = 3600) {
  const path = pathFromStoredUrl(url, bucket);
  if (!path) return null;
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  return error ? null : data.signedUrl;
}

async function signStoredUrls(urls, bucket, ttlSeconds = 3600) {
  if (!urls || urls.length === 0) return urls || [];
  return Promise.all(urls.map(u => signStoredUrl(u, bucket, ttlSeconds)));
}

const TABLES = {
  incident: {
    name: 'incidents',
    listColumns: 'id, reporter_name, site, occurred_at, incident_type, injured_person, body_part, treatment, medical_attention, witnesses, evidence, report_json, photo_urls, company_id, pdf_url, signature_url, created_at, reviewed, reviewed_by, reviewed_at, review_notes',
  },
  nearmiss: {
    name: 'near_misses',
    listColumns: 'id, reporter_name, is_anonymous, site, occurred_at, involved, report_json, company_id, pdf_url, signature_url, created_at, reviewed, reviewed_by, reviewed_at, review_notes',
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, action, token } = req.body || {};

  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ── Photo/signature/PDF uploads for incident + near-miss reports ────
    if (action === 'create_upload_url') {
      const { bucket, filename } = req.body;
      if (!['incident-photos', 'signatures', 'flha-reports'].includes(bucket)) {
        return res.status(400).json({ error: 'Invalid bucket.' });
      }
      const result = await createUploadUrl(supabaseAdmin, bucket, filename);
      if (result.error) return res.status(500).json({ error: result.error });
      return res.status(200).json({ ok: true, path: result.path, uploadToken: result.uploadToken });
    }

    const table = TABLES[type];
    if (!table) return res.status(400).json({ error: 'Unknown report type.' });

    // ── Worker: submit a new report ─────────────────────────────────
    if (action === 'submit') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data: coRows } = await supabaseAdmin.from('companies').select('suspended').eq('id', session.companyId).limit(1);
      if (coRows && coRows[0] && coRows[0].suspended) {
        return res.status(403).json({ error: "Your company's access is suspended. Contact your administrator." });
      }
      const { record } = req.body;
      if (!record) return res.status(400).json({ error: 'Missing record.' });
      const { data, error } = await supabaseAdmin
        .from(table.name)
        .insert({ ...record, company_id: session.companyId })
        .select('id')
        .limit(1);
      if (error) return res.status(500).json({ error: 'Save failed. Try again.' });
      return res.status(200).json({ id: data?.[0]?.id || null });
    }

    // ── Supervisor / Admin: load reports for the dashboard ──────────
    if (action === 'list') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      let query = supabaseAdmin.from(table.name).select(table.listColumns).order('created_at', { ascending: false });
      if (session.role === 'supervisor') query = query.eq('company_id', session.companyId);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load records.' });
      const records = await Promise.all((data || []).map(async r => ({
        ...r,
        pdf_url: await signStoredUrl(r.pdf_url, 'flha-reports'),
        signature_url: r.signature_url ? await signStoredUrl(r.signature_url, 'signatures') : r.signature_url,
        photo_urls: r.photo_urls ? await signStoredUrls(r.photo_urls, 'incident-photos') : r.photo_urls,
      })));
      return res.status(200).json({ records });
    }

    // ── Supervisor / Admin: mark a report reviewed ───────────────────
    if (action === 'review') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id, notes, pdfUrl, reviewedBy: reviewedByInput } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing record id.' });

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from(table.name).select('id, company_id').eq('id', id).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to review this record.' });
        }
      }
      const now = new Date().toISOString();
      const reviewedBy = (typeof reviewedByInput === 'string' && reviewedByInput.trim())
        ? reviewedByInput.trim()
        : (session.role === 'admin' ? 'Admin' : 'Supervisor');
      const update = { reviewed: true, reviewed_by: reviewedBy, reviewed_at: now, review_notes: notes || null };
      if (pdfUrl) update.pdf_url = pdfUrl;
      const { error } = await supabaseAdmin.from(table.name).update(update).eq('id', id);
      if (error) return res.status(500).json({ error: 'Review failed.' });
      const signedPdfUrl = pdfUrl ? await signStoredUrl(pdfUrl, 'flha-reports') : null;
      return res.status(200).json({ ok: true, reviewed_by: reviewedBy, reviewed_at: now, pdfUrl: signedPdfUrl });
    }

    // ── Supervisor / Admin: delete a report ──────────────────────────
    if (action === 'delete') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing record id.' });

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from(table.name).select('id, company_id').eq('id', id).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to delete this record.' });
        }
      }
      const { error } = await supabaseAdmin.from(table.name).delete().eq('id', id);
      if (error) return res.status(500).json({ error: 'Delete failed.' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
