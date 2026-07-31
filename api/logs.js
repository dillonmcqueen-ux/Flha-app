// api/logs.js
// Handles Equipment Inspections (pre-trip + post-trip), Toolbox Talks, and
// Daily Reports — submitting, viewing, and deleting — with the same
// session checks as the other protected endpoints.

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

const TABLES = {
  inspection: {
    name: 'inspections',
    listColumns: 'id, worker_name, equipment_label, created_at, results_json, signed_by, company_id, pdf_url, trip_type, linked_inspection_id, start_reading, end_reading, reading_unit, has_changes',
  },
  toolbox: {
    name: 'toolbox_talks',
    listColumns: 'id, presenter_name, meeting_type, site, topic, talking_points_json, attendees_json, company_id, pdf_url, created_at',
  },
  daily: {
    name: 'daily_reports',
    listColumns: 'id, reporter_name, site, report_date, weather, temperature, crew, equipment, visitors, report_json, company_id, pdf_url, created_at',
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, action, token } = req.body || {};
  const table = TABLES[type];
  if (!table) return res.status(400).json({ error: 'Unknown record type.' });

  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ── Worker: check a piece of equipment before starting an inspection ─
    // Only applies to inspections. Returns:
    //  - openPretrip: a pre-trip from TODAY on this machine with no matching
    //    post-trip yet (so the worker can be offered "do the post-trip")
    //  - lastInspection: the most recent inspection of any kind on this
    //    machine, so we can flag if it had defects/monitor items
    if (action === 'check_equipment') {
      if (type !== 'inspection') return res.status(400).json({ error: 'Not applicable for this record type.' });
      if (session.role !== 'worker' && session.role !== 'supervisor' && session.role !== 'admin') return res.status(403).json({ error: 'Not allowed.' });
      const { equipmentLabel } = req.body;
      if (!equipmentLabel) return res.status(400).json({ error: 'Missing equipment.' });

      const { data, error } = await supabaseAdmin
        .from('inspections')
        .select('id, worker_name, equipment_label, created_at, results_json, trip_type, linked_inspection_id, start_reading, end_reading, reading_unit, has_changes')
        .eq('company_id', session.companyId)
        .eq('equipment_label', equipmentLabel)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) return res.status(500).json({ error: 'Could not check equipment history.' });

      const rows = data || [];
      const lastInspection = rows[0] || null;

      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const pretripsToday = rows.filter(r => (r.trip_type || 'pretrip') === 'pretrip' && new Date(r.created_at) >= startOfDay);
      const openPretrip = pretripsToday.find(pt =>
        !rows.some(r => r.trip_type === 'posttrip' && r.linked_inspection_id === pt.id)
      ) || null;

      return res.status(200).json({ openPretrip, lastInspection });
    }

    // ── Worker: submit a new record ─────────────────────────────────
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

    // ── Supervisor / Admin: load records for the dashboard ──────────
    if (action === 'list') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      let query = supabaseAdmin.from(table.name).select(table.listColumns).order('created_at', { ascending: false });
      if (session.role === 'supervisor') query = query.eq('company_id', session.companyId);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load records.' });
      const records = await Promise.all((data || []).map(async r => ({ ...r, pdf_url: await signStoredUrl(r.pdf_url, 'flha-reports') })));
      return res.status(200).json({ records });
    }

    // ── Supervisor / Admin: delete a record ──────────────────────────
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

    // ── Toolbox Talk: list recent talks someone can still sign ──────
    // Anyone who missed a talk (or a supervisor helping them find it) picks
    // from the last two weeks for their own company — no pre-registered
    // "expected attendees" list, so this works the same for shared-code and
    // individually-identified companies alike.
    if (action === 'list_open_toolbox') {
      if (type !== 'toolbox') return res.status(400).json({ error: 'Not applicable for this record type.' });
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabaseAdmin
        .from('toolbox_talks')
        .select('id, presenter_name, meeting_type, site, topic, attendees_json, created_at')
        .eq('company_id', session.companyId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) return res.status(500).json({ error: 'Could not load recent toolbox talks.' });
      const talks = (data || []).map(t => ({ ...t, signedCount: (t.attendees_json || []).length }));
      return res.status(200).json({ talks });
    }

    // ── Toolbox Talk: full detail for the sign-later confirm screen ─
    if (action === 'get_toolbox_detail') {
      if (type !== 'toolbox') return res.status(400).json({ error: 'Not applicable for this record type.' });
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing record id.' });
      const { data, error } = await supabaseAdmin.from('toolbox_talks').select('*').eq('id', id).limit(1);
      if (error || !data || data.length === 0) return res.status(404).json({ error: 'Toolbox talk not found.' });
      const record = data[0];
      if (record.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      record.pdf_url = await signStoredUrl(record.pdf_url, 'flha-reports');
      const { data: coRows } = await supabaseAdmin.from('companies').select('id, name, logo_url').eq('id', record.company_id).limit(1);
      return res.status(200).json({ record, company: coRows && coRows[0] });
    }

    // ── Toolbox Talk: add a late signature to an existing talk ──────
    if (action === 'sign_late_toolbox') {
      if (type !== 'toolbox') return res.status(400).json({ error: 'Not applicable for this record type.' });
      const { id, name, signature, pdfUrl } = req.body;
      if (!id || !name || !signature) return res.status(400).json({ error: 'Missing details.' });

      const { data: rows, error: findErr } = await supabaseAdmin.from('toolbox_talks').select('id, company_id, attendees_json').eq('id', id).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Toolbox talk not found.' });
      const existing = rows[0];
      if (existing.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });

      const attendees = [...(existing.attendees_json || []), {
        name: name.trim(),
        signature,
        signedLate: true,
        signedAt: new Date().toISOString(),
      }];
      const update = { attendees_json: attendees };
      if (pdfUrl) update.pdf_url = pdfUrl;
      const { error } = await supabaseAdmin.from('toolbox_talks').update(update).eq('id', id);
      if (error) return res.status(500).json({ error: 'Could not save your signature. Try again.' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
