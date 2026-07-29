// api/equipmentreports.js
// Weekly equipment usage reports — aggregates pre-trip/post-trip inspection
// readings into a per-machine summary (hours/km used, ending reading,
// outstanding flagged issues). Viewable from the Supervisor Dashboard.
// Actual PDF rendering happens client-side (same jsPDF-via-CDN pattern as
// every other document in the app) the first time a report is opened —
// this endpoint only computes and stores the underlying data, plus lets
// the client save the resulting pdf_url back once generated.

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

// Admins may act on any company they specify; supervisors are always
// locked to their own session.companyId, regardless of what they send.
function resolveCompanyId(session, requestedCompanyId) {
  if (session.role === 'admin') return requestedCompanyId || null;
  return session.companyId;
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

// Monday of the week containing `d` (ISO week, Monday start).
function mondayOf(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

// Builds the report_json for one company + week by pulling every
// pre-trip/post-trip inspection pair whose post-trip falls in the range.
async function buildReportForCompanyWeek(companyId, weekStartISO, weekEndISO) {
  // weekEndISO is exclusive upper bound (Monday after the week)
  const { data: records, error } = await supabaseAdmin
    .from('inspections')
    .select('id, equipment_label, worker_name, created_at, trip_type, linked_inspection_id, start_reading, end_reading, reading_unit, has_changes, results_json')
    .eq('company_id', companyId)
    .gte('created_at', weekStartISO)
    .lt('created_at', weekEndISO)
    .order('created_at', { ascending: true });
  if (error) throw new Error('Could not load inspections: ' + error.message);

  const byEquipment = {};
  const ensure = (label) => {
    if (!byEquipment[label]) {
      byEquipment[label] = { equipmentLabel: label, unit: null, usage: 0, endingReading: null, endingReadingDate: null, issues: [], noPostTripCount: 0 };
    }
    return byEquipment[label];
  };

  (records || []).forEach(r => {
    const label = r.equipment_label || 'Unknown equipment';
    const entry = ensure(label);
    if (r.reading_unit) entry.unit = r.reading_unit;

    if (r.trip_type === 'posttrip') {
      const start = parseFloat(r.start_reading);
      const end = parseFloat(r.end_reading);
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        entry.usage += (end - start);
      }
      if (!isNaN(end)) {
        // Keep the latest (by created_at, already ascending) ending reading for the week.
        entry.endingReading = end;
        entry.endingReadingDate = r.created_at;
      }
      if (r.has_changes) {
        const rr = r.results_json || {};
        entry.issues.push({
          date: r.created_at,
          worker: r.worker_name,
          type: rr.changeCondition || 'Flagged',
          note: rr.changeNotes || '(no details provided)',
        });
      }
    } else {
      // pretrip
      const items = (r.results_json?.items) || [];
      items.filter(it => it.condition === 'Defective' || it.condition === 'Monitor').forEach(it => {
        entry.issues.push({
          date: r.created_at,
          worker: r.worker_name,
          type: it.condition,
          note: `${it.item}${it.note ? `: ${it.note}` : ''}`,
        });
      });
      // Track pretrips with no matching posttrip yet (checked out, not returned).
      const hasPosttrip = (records || []).some(p => p.trip_type === 'posttrip' && p.linked_inspection_id === r.id);
      if (!hasPosttrip) entry.noPostTripCount += 1;
    }
  });

  const equipment = Object.values(byEquipment).sort((a, b) => a.equipmentLabel.localeCompare(b.equipmentLabel));
  return { weekStart: weekStartISO, weekEnd: toISODate(new Date(new Date(weekEndISO).getTime() - 86400000)), equipment };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });
  if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });

  try {
    // List all generated reports for a company, newest first.
    if (action === 'list_reports') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('equipment_reports')
        .select('id, week_start, week_end, pdf_url, generated_by, created_at')
        .eq('company_id', companyId)
        .order('week_start', { ascending: false });
      if (error) return res.status(500).json({ error: 'Could not load reports.' });
      const reports = await Promise.all((data || []).map(async r => ({ ...r, pdf_url: await signStoredUrl(r.pdf_url, 'flha-reports') })));
      return res.status(200).json({ reports });
    }

    // Full detail (report_json) for one report — used to render the PDF client-side.
    if (action === 'get_report') {
      const { reportId } = req.body;
      if (!reportId) return res.status(400).json({ error: 'Missing report id.' });
      const { data, error } = await supabaseAdmin.from('equipment_reports').select('*').eq('id', reportId).limit(1);
      if (error || !data || data.length === 0) return res.status(404).json({ error: 'Report not found.' });
      const report = data[0];
      if (session.role === 'supervisor' && report.company_id !== session.companyId) {
        return res.status(403).json({ error: 'Not allowed.' });
      }
      report.pdf_url = await signStoredUrl(report.pdf_url, 'flha-reports');
      const { data: coRows } = await supabaseAdmin.from('companies').select('id, name, logo_url').eq('id', report.company_id).limit(1);
      return res.status(200).json({ report, company: coRows && coRows[0] });
    }

    // Client calls this once it has generated and uploaded the PDF, to cache the URL.
    if (action === 'save_pdf_url') {
      const { reportId, pdfUrl } = req.body;
      if (!reportId || !pdfUrl) return res.status(400).json({ error: 'Missing details.' });
      if (session.role === 'supervisor') {
        const { data: existing } = await supabaseAdmin.from('equipment_reports').select('company_id').eq('id', reportId).limit(1);
        if (!existing || existing.length === 0 || existing[0].company_id !== session.companyId) {
          return res.status(403).json({ error: 'Not allowed.' });
        }
      }
      const { error } = await supabaseAdmin.from('equipment_reports').update({ pdf_url: pdfUrl }).eq('id', reportId);
      if (error) return res.status(500).json({ error: "Couldn't save PDF link." });
      return res.status(200).json({ ok: true });
    }

    // Manual on-demand generation for a specific company + week (defaults to
    // last completed week if no dates given). Overwrites any existing report
    // for that company+week (upsert), clearing a stale pdf_url so it regenerates.
    if (action === 'generate_now') {
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { weekStart } = req.body;

      const anchor = weekStart ? new Date(weekStart) : new Date();
      const monday = weekStart ? mondayOf(anchor) : mondayOf(new Date(anchor.getTime() - 7 * 86400000));
      const weekStartISO = toISODate(monday);
      const nextMonday = new Date(monday); nextMonday.setDate(nextMonday.getDate() + 7);
      const weekEndExclusiveISO = nextMonday.toISOString();

      const reportJson = await buildReportForCompanyWeek(companyId, monday.toISOString(), weekEndExclusiveISO);

      const { data, error } = await supabaseAdmin
        .from('equipment_reports')
        .upsert(
          { company_id: companyId, week_start: weekStartISO, week_end: reportJson.weekEnd, report_json: reportJson, pdf_url: null, generated_by: 'manual' },
          { onConflict: 'company_id,week_start' }
        )
        .select()
        .single();
      if (error) return res.status(500).json({ error: "Couldn't generate report: " + error.message });
      return res.status(200).json({ ok: true, report: data });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Server error. Please try again.' });
  }
}

// Exported so the cron endpoint can reuse the exact same aggregation logic.
export { buildReportForCompanyWeek, mondayOf, toISODate };
