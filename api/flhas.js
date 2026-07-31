// api/flhas.js
// All FLHA database operations go through here now instead of straight from
// the browser. Every request must include a valid session token (the "pass"
// issued at login) and we double-check the caller is allowed to do what
// they're asking before touching the database.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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

// flha-reports is a private bucket — the DB still stores a "public"-shaped
// URL (upload code never changed), but that string is never itself a
// working link. Every value handed to a client is swapped for a
// short-lived signed URL first.
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ── Worker: find today's FLHA to resume/amend ─────────────────────
    if (action === 'resume') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { workerName } = req.body;
      if (!workerName || !workerName.trim()) return res.status(400).json({ error: 'Enter your name.' });

      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data, error } = await supabaseAdmin
        .from('flhas')
        .select('id, worker_name, job_site, hazards_json, created_at, worker_signature')
        .eq('company_id', session.companyId)
        .gte('created_at', start.toISOString())
        .order('created_at', { ascending: false });

      if (error) return res.status(500).json({ error: 'Something went wrong. Try again.' });
      const matches = (data || []).filter(
        f => (f.worker_name || '').trim().toLowerCase() === workerName.trim().toLowerCase()
      );
      return res.status(200).json({ matches });
    }

    // ── Worker: submit a new FLHA or save an amendment ─────────────────
    if (action === 'submit') {
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data: coRows } = await supabaseAdmin.from('companies').select('suspended').eq('id', session.companyId).limit(1);
      if (coRows && coRows[0] && coRows[0].suspended) {
        return res.status(403).json({ error: "Your company's access is suspended. Contact your administrator." });
      }
      const { amendingId, record } = req.body;
      if (!record) return res.status(400).json({ error: 'Missing record.' });

      if (amendingId) {
        // Confirm this record actually belongs to the worker's own company first.
        const { data: existing, error: findErr } = await supabaseAdmin
          .from('flhas').select('id, company_id').eq('id', amendingId).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to amend this record.' });
        }
        const { error } = await supabaseAdmin.from('flhas').update(record).eq('id', amendingId);
        if (error) return res.status(500).json({ error: 'Save failed. Try again.' });
        return res.status(200).json({ id: amendingId });
      } else {
        const { data, error } = await supabaseAdmin
          .from('flhas')
          .insert({ ...record, company_id: session.companyId })
          .select('id')
          .limit(1);
        if (error) return res.status(500).json({ error: 'Save failed. Try again.' });
        return res.status(200).json({ id: data?.[0]?.id || null });
      }
    }

    // ── Supervisor / Admin: load FLHAs for the dashboard ────────────────
    if (action === 'list') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      let query = supabaseAdmin
        .from('flhas')
        .select('id, worker_name, job_site, created_at, hazards_json, signed_by, company_id, pdf_url, status, supervisor_signed_by, supervisor_signed_at, worker_signature')
        .order('created_at', { ascending: false });
      if (session.role === 'supervisor') query = query.eq('company_id', session.companyId);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load records.' });
      const flhas = await Promise.all((data || []).map(async f => ({ ...f, pdf_url: await signStoredUrl(f.pdf_url, 'flha-reports') })));
      return res.status(200).json({ flhas });
    }

    // ── Supervisor / Admin: delete one or more FLHAs ────────────────────
    if (action === 'delete') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { ids } = req.body;
      if (!ids || !ids.length) return res.status(400).json({ error: 'No records specified.' });

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from('flhas').select('id, company_id').in('id', ids);
        if (findErr) return res.status(500).json({ error: 'Delete failed.' });
        const notOwned = (existing || []).some(r => r.company_id !== session.companyId);
        if (notOwned) return res.status(403).json({ error: 'Not allowed to delete some of these records.' });
      }
      const { error } = await supabaseAdmin.from('flhas').delete().in('id', ids);
      if (error) return res.status(500).json({ error: 'Delete failed.' });
      return res.status(200).json({ ok: true });
    }

    // ── Supervisor / Admin: approve an extreme-risk FLHA ────────────────
    if (action === 'approve') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id, supName, supSignature, pdfUrl } = req.body;
      if (!id || !supName || !supSignature) return res.status(400).json({ error: 'Missing approval details.' });

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from('flhas').select('id, company_id').eq('id', id).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to approve this record.' });
        }
      }
      const now = new Date().toISOString();
      const { error } = await supabaseAdmin.from('flhas').update({
        status: 'complete',
        supervisor_signed_by: supName,
        supervisor_signed_at: now,
        pdf_url: pdfUrl || null,
      }).eq('id', id);
      if (error) return res.status(500).json({ error: 'Approval failed.' });
      const signedPdfUrl = pdfUrl ? await signStoredUrl(pdfUrl, 'flha-reports') : null;
      return res.status(200).json({ ok: true, supervisor_signed_at: now, pdfUrl: signedPdfUrl });
    }

    // ── Admin: count FLHAs per company (used on the onboarding console) ─
    if (action === 'count') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { data, error } = await supabaseAdmin.from('flhas').select('id, company_id');
      if (error) return res.status(500).json({ error: 'Could not load counts.' });
      const counts = {};
      (data || []).forEach(f => { counts[f.company_id] = (counts[f.company_id] || 0) + 1; });
      return res.status(200).json({ counts });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
