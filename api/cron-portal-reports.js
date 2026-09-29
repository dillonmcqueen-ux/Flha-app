// api/cron-portal-reports.js
// Hit automatically by Vercel Cron, daily. Sends every due Company Portal
// report schedule (docs/schema/portal-report-schedules-migration.sql): each
// one emails the completed documents routed to its department since it last
// went out. A separate function from the other crons on purpose, same
// reasoning as api/cron-company-brain-summary.js: different cadence and
// trigger source, and this repo is on Vercel's Pro plan.
// Protected by CRON_SECRET, same as the other crons.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { isDue, runSchedule } from '../server-lib/portalReports.js';
import { recordPlatformEvent } from '../server-lib/platformEvents.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (!process.env.CRON_SECRET || !authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const startedAt = Date.now();
  try {
    const { data: schedules, error } = await supabaseAdmin
      .from('portal_report_schedules').select('*').eq('active', true);
    if (error) throw new Error(error.message);

    // Same gate as the equipment report cron: a company that is suspended or
    // has the roster (and so Portal) switched off gets nothing.
    const { data: companies } = await supabaseAdmin.from('companies').select('id, roster_enabled, suspended');
    const live = new Set((companies || []).filter((c) => c.roster_enabled && !c.suspended).map((c) => c.id));

    const now = new Date();
    const results = [];
    for (const schedule of (schedules || []).filter((s) => live.has(s.company_id) && isDue(s, now))) {
      try {
        results.push({ id: schedule.id, ...(await runSchedule(supabaseAdmin, schedule, now)) });
      } catch (e) {
        // One broken schedule must not stop the rest.
        console.error(`portal report schedule ${schedule.id} failed:`, e.message);
        results.push({ id: schedule.id, error: true });
      }
    }
    const failed = results.filter((r) => r.error).length;
    await recordPlatformEvent(supabaseAdmin, {
      eventType: 'cron_run', subtype: 'portal_reports', status: failed > 0 ? 'error' : 'ok',
      metrics: { ran: results.length, failed, duration_ms: Date.now() - startedAt },
    });
    return res.status(200).json({ ran: results.length, results });
  } catch (e) {
    console.error('cron-portal-reports failed:', e.message);
    await recordPlatformEvent(supabaseAdmin, { eventType: 'cron_run', subtype: 'portal_reports', status: 'error', metrics: { duration_ms: Date.now() - startedAt } });
    return res.status(500).json({ error: 'Portal report run failed.' });
  }
}
