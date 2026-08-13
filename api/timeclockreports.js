// api/timeclockreports.js
// Builds the weekly time-clock report_json for one company — total + per-day
// hours for every roster member with at least one punch that week. Used by
// both the weekly cron (api/cron-equipment-reports.js) and companydata.js's
// generate_time_report_now action; the client-facing time-clock actions
// (clock in/out, get_timeclock_report, etc.) still live in api/companydata.js,
// which this file does not duplicate. Split out of companydata.js once the
// Vercel Hobby-plan 12-function cap that had forced it to share a file no
// longer applied (see vercel-function-budget-guardian.md).

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

async function buildTimeClockReportForCompanyWeek(companyId, weekStartFullISO, weekEndExclusiveFullISO) {
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

// Not a public endpoint — this file exists purely as a module the cron job
// imports from. Nothing routes to it directly, but Vercel's zero-config
// convention still expects a default export for anything under api/.
export default async function handler(req, res) {
  return res.status(404).json({ error: 'Not found.' });
}

export { buildTimeClockReportForCompanyWeek };
