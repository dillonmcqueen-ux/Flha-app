// api/timeclock.js
// Individual clock-in/clock-out time tracking, restricted to companies on
// individual roster logins — there's no per-person identity to attribute a
// punch to on a shared company code. Workers can only clock themselves
// in/out; only supervisors/admins can edit, add, or delete an entry.
// Weekly PDF reports follow the same pattern as api/equipmentreports.js:
// this file only computes and stores report_json, the PDF renders
// client-side on first view.

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

function isUniqueViolation(error) {
  return error && error.code === '23505';
}

// Builds the report_json for one company + week: total + per-day hours for
// every roster member with at least one punch that week.
async function buildReportForCompanyWeek(companyId, weekStartFullISO, weekEndExclusiveFullISO) {
  const { data: entries, error } = await supabaseAdmin
    .from('time_clock_entries')
    .select('id, roster_id, clock_in, clock_out, edited_at')
    .eq('company_id', companyId)
    .gte('clock_in', weekStartFullISO)
    .lt('clock_in', weekEndExclusiveFullISO)
    .order('clock_in', { ascending: true });
  if (error) throw new Error('Could not load time clock entries: ' + error.message);

  const weekStart = toISODate(new Date(weekStartFullISO));
  const weekEnd = toISODate(new Date(new Date(weekEndExclusiveFullISO).getTime() - 86400000));

  if (!entries || entries.length === 0) {
    return { weekStart, weekEnd, entries: [] };
  }

  const rosterIds = [...new Set(entries.map(e => e.roster_id))];
  const { data: rosterRows, error: rosterErr } = await supabaseAdmin
    .from('roster')
    .select('id, name, role')
    .in('id', rosterIds);
  if (rosterErr) throw new Error('Could not load roster: ' + rosterErr.message);
  const rosterById = Object.fromEntries((rosterRows || []).map(r => [r.id, r]));

  const byRoster = {};
  entries.forEach(e => {
    const person = byRoster[e.roster_id] || (byRoster[e.roster_id] = {
      rosterId: e.roster_id,
      name: rosterById[e.roster_id]?.name || 'Unknown',
      role: rosterById[e.roster_id]?.role || 'worker',
      totalHours: 0,
      days: [],
    });
    const clockInDate = new Date(e.clock_in);
    const date = clockInDate.toISOString().slice(0, 10);
    let hours = null;
    const openAtReportTime = !e.clock_out;
    if (e.clock_out) {
      hours = (new Date(e.clock_out) - clockInDate) / 3600000;
      person.totalHours += hours;
    }
    person.days.push({ date, clockIn: e.clock_in, clockOut: e.clock_out, hours, edited: !!e.edited_at, openAtReportTime });
  });

  const entriesOut = Object.values(byRoster)
    .map(p => ({ ...p, totalHours: Math.round(p.totalHours * 100) / 100 }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { weekStart, weekEnd, entries: entriesOut };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, token } = req.body || {};
  const session = await verifySession(token);
  if (!session) return res.status(401).json({ error: 'Not logged in. Please log in again.' });

  try {
    // ── Self-service: clock in/out, own status. Any registered (roster) ──
    // user — worker or supervisor. Not reachable without a userId, which is
    // the real enforcement point (not just hiding the button in the UI).
    if (action === 'clock_in') {
      if (!session.userId) return res.status(403).json({ error: 'Not available for this login.' });
      const { error } = await supabaseAdmin.from('time_clock_entries').insert({
        company_id: session.companyId,
        roster_id: session.userId,
      });
      if (error) {
        if (isUniqueViolation(error)) return res.status(400).json({ error: "You're already clocked in." });
        return res.status(500).json({ error: "Couldn't clock in." });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'clock_out') {
      if (!session.userId) return res.status(403).json({ error: 'Not available for this login.' });
      const { data: openRows, error: openErr } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id')
        .eq('roster_id', session.userId)
        .is('clock_out', null)
        .limit(1);
      if (openErr) return res.status(500).json({ error: "Couldn't clock out." });
      if (!openRows || openRows.length === 0) return res.status(404).json({ error: "You're not clocked in." });
      const { error } = await supabaseAdmin.from('time_clock_entries').update({ clock_out: new Date().toISOString() }).eq('id', openRows[0].id);
      if (error) return res.status(500).json({ error: "Couldn't clock out." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'my_status') {
      if (!session.userId) return res.status(403).json({ error: 'Not available for this login.' });
      const { data: openRows } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id, clock_in')
        .eq('roster_id', session.userId)
        .is('clock_out', null)
        .limit(1);
      const { data: recent, error: recentErr } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id, clock_in, clock_out')
        .eq('roster_id', session.userId)
        .order('clock_in', { ascending: false })
        .limit(10);
      if (recentErr) return res.status(500).json({ error: "Couldn't load your time clock status." });
      return res.status(200).json({ open: (openRows && openRows[0]) || null, recent: recent || [] });
    }

    // ── Supervisor / Admin: view + edit everyone's entries ──────────────
    if (action === 'list_entries') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });

      const anchor = req.body.weekStart ? new Date(req.body.weekStart) : new Date();
      const monday = mondayOf(anchor);
      const nextMonday = new Date(monday); nextMonday.setDate(nextMonday.getDate() + 7);

      const { data: roster, error: rosterErr } = await supabaseAdmin
        .from('roster')
        .select('id, name, role, active')
        .eq('company_id', companyId)
        .order('name', { ascending: true });
      if (rosterErr) return res.status(500).json({ error: 'Could not load roster.' });

      const { data: entries, error: entriesErr } = await supabaseAdmin
        .from('time_clock_entries')
        .select('id, roster_id, clock_in, clock_out, edited_by_roster_id, edited_at')
        .eq('company_id', companyId)
        .gte('clock_in', monday.toISOString())
        .lt('clock_in', nextMonday.toISOString())
        .order('clock_in', { ascending: true });
      if (entriesErr) return res.status(500).json({ error: 'Could not load time clock entries.' });

      return res.status(200).json({
        weekStart: toISODate(monday),
        weekEnd: toISODate(new Date(nextMonday.getTime() - 86400000)),
        roster: roster || [],
        entries: entries || [],
      });
    }

    if (action === 'edit_entry') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { entryId, clockIn, clockOut } = req.body;
      if (!entryId || !clockIn) return res.status(400).json({ error: 'Missing entry details.' });
      const { data: rows, error: findErr } = await supabaseAdmin.from('time_clock_entries').select('id, company_id').eq('id', entryId).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Entry not found.' });
      if (session.role === 'supervisor' && rows[0].company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });

      const { error } = await supabaseAdmin.from('time_clock_entries').update({
        clock_in: clockIn,
        clock_out: clockOut || null,
        edited_by_roster_id: session.userId || null,
        edited_at: new Date().toISOString(),
      }).eq('id', entryId);
      if (error) {
        if (isUniqueViolation(error)) return res.status(400).json({ error: 'That person already has an open entry — close it first.' });
        return res.status(500).json({ error: "Couldn't save the change." });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'add_entry') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      const { rosterId, clockIn, clockOut } = req.body;
      if (!companyId || !rosterId || !clockIn) return res.status(400).json({ error: 'Missing entry details.' });

      const { data: memberRows, error: memberErr } = await supabaseAdmin.from('roster').select('id, company_id').eq('id', rosterId).limit(1);
      if (memberErr || !memberRows || memberRows.length === 0 || memberRows[0].company_id !== companyId) {
        return res.status(400).json({ error: 'That person is not on this company\'s roster.' });
      }

      const { error } = await supabaseAdmin.from('time_clock_entries').insert({
        company_id: companyId,
        roster_id: rosterId,
        clock_in: clockIn,
        clock_out: clockOut || null,
        edited_by_roster_id: session.userId || null,
        edited_at: new Date().toISOString(),
      });
      if (error) {
        if (isUniqueViolation(error)) return res.status(400).json({ error: 'That person already has an open entry.' });
        return res.status(500).json({ error: "Couldn't add the entry." });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete_entry') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { entryId } = req.body;
      if (!entryId) return res.status(400).json({ error: 'Missing entry id.' });
      const { data: rows, error: findErr } = await supabaseAdmin.from('time_clock_entries').select('id, company_id').eq('id', entryId).limit(1);
      if (findErr || !rows || rows.length === 0) return res.status(404).json({ error: 'Entry not found.' });
      if (session.role === 'supervisor' && rows[0].company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      const { error } = await supabaseAdmin.from('time_clock_entries').delete().eq('id', entryId);
      if (error) return res.status(500).json({ error: "Couldn't delete the entry." });
      return res.status(200).json({ ok: true });
    }

    // ── Weekly PDF reports (same shape as api/equipmentreports.js) ──────
    if (action === 'list_reports') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { data, error } = await supabaseAdmin
        .from('timeclock_reports')
        .select('id, week_start, week_end, pdf_url, generated_by, created_at')
        .eq('company_id', companyId)
        .order('week_start', { ascending: false });
      if (error) return res.status(500).json({ error: 'Could not load reports.' });
      return res.status(200).json({ reports: data || [] });
    }

    if (action === 'get_report') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { reportId } = req.body;
      if (!reportId) return res.status(400).json({ error: 'Missing report id.' });
      const { data, error } = await supabaseAdmin.from('timeclock_reports').select('*').eq('id', reportId).limit(1);
      if (error || !data || data.length === 0) return res.status(404).json({ error: 'Report not found.' });
      const report = data[0];
      if (session.role === 'supervisor' && report.company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      const { data: coRows } = await supabaseAdmin.from('companies').select('id, name, logo_url').eq('id', report.company_id).limit(1);
      return res.status(200).json({ report, company: coRows && coRows[0] });
    }

    if (action === 'save_pdf_url') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const { reportId, pdfUrl } = req.body;
      if (!reportId || !pdfUrl) return res.status(400).json({ error: 'Missing details.' });
      if (session.role === 'supervisor') {
        const { data: existing } = await supabaseAdmin.from('timeclock_reports').select('company_id').eq('id', reportId).limit(1);
        if (!existing || existing.length === 0 || existing[0].company_id !== session.companyId) return res.status(403).json({ error: 'Not allowed.' });
      }
      const { error } = await supabaseAdmin.from('timeclock_reports').update({ pdf_url: pdfUrl }).eq('id', reportId);
      if (error) return res.status(500).json({ error: "Couldn't save PDF link." });
      return res.status(200).json({ ok: true });
    }

    if (action === 'generate_now') {
      if (session.role !== 'admin' && session.role !== 'supervisor') return res.status(403).json({ error: 'Not allowed.' });
      const companyId = resolveCompanyId(session, req.body.companyId);
      if (!companyId) return res.status(400).json({ error: 'Missing company id.' });
      const { weekStart } = req.body;

      const anchor = weekStart ? new Date(weekStart) : new Date();
      const monday = weekStart ? mondayOf(anchor) : mondayOf(new Date(anchor.getTime() - 7 * 86400000));
      const nextMonday = new Date(monday); nextMonday.setDate(nextMonday.getDate() + 7);

      const reportJson = await buildReportForCompanyWeek(companyId, monday.toISOString(), nextMonday.toISOString());

      const { data, error } = await supabaseAdmin
        .from('timeclock_reports')
        .upsert(
          { company_id: companyId, week_start: reportJson.weekStart, week_end: reportJson.weekEnd, report_json: reportJson, pdf_url: null, generated_by: 'manual' },
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
