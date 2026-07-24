// api/reports.js
// Handles Incident and Near Miss reports — submitting, viewing, reviewing,
// and deleting — all with the same session checks as api/flhas.js. One file
// covers both report types since they work the same way.

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
  incident: {
    name: 'incidents',
    listColumns: 'id, reporter_name, site, occurred_at, incident_type, injured_person, body_part, treatment, medical_attention, witnesses, evidence, report_json, photo_urls, company_id, pdf_url, created_at, reviewed, reviewed_by, reviewed_at, review_notes',
  },
  nearmiss: {
    name: 'near_misses',
    listColumns: 'id, reporter_name, is_anonymous, site, occurred_at, involved, report_json, company_id, pdf_url, created_at, reviewed, reviewed_by, reviewed_at, review_notes',
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, action, token } = req.body || {};
  const table = TABLES[type];
  if (!table) return res.status(400).json({ error: 'Unknown report type.' });

  const session = verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ── Worker: submit a new report ─────────────────────────────────
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

    // ── Supervisor / Admin: load reports for the dashboard ──────────
    if (action === 'list') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      let query = supabaseAdmin.from(table.name).select(table.listColumns).order('created_at', { ascending: false });
      if (session.role === 'supervisor') query = query.eq('company_id', session.companyId);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: 'Could not load records.' });
      return res.status(200).json({ records: data || [] });
    }

    // ── Supervisor / Admin: mark a report reviewed ───────────────────
    if (action === 'review') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { id, notes, pdfUrl } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing record id.' });

      if (session.role === 'supervisor') {
        const { data: existing, error: findErr } = await supabaseAdmin.from(table.name).select('id, company_id').eq('id', id).limit(1);
        if (findErr || !existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed to review this record.' });
        }
      }
      const now = new Date().toISOString();
      const reviewedBy = session.role === 'admin' ? 'Admin' : 'Supervisor';
      const update = { reviewed: true, reviewed_by: reviewedBy, reviewed_at: now, review_notes: notes || null };
      if (pdfUrl) update.pdf_url = pdfUrl;
      const { error } = await supabaseAdmin.from(table.name).update(update).eq('id', id);
      if (error) return res.status(500).json({ error: 'Review failed.' });
      return res.status(200).json({ ok: true, reviewed_by: reviewedBy, reviewed_at: now });
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
