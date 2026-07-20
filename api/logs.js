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

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(data)
    .digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch (e) {
    return null;
  }
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

  const session = verifySession(token);
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
      if (session.role !== 'worker') return res.status(403).json({ error: 'Not allowed.' });
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
      if (session.role !== 'worker') return res.status(403).json({ error: 'Not allowed.' });
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
      return res.status(200).json({ records: data || [] });
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

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
