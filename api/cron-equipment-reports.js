// api/cron-equipment-reports.js
// Hit automatically by Vercel Cron every Monday morning. Generates last
// week's equipment usage report AND time clock report for every company
// (the latter only for companies on individual roster logins). Both jobs
// live in one file/function to stay under Vercel's serverless function
// count limit. Protected by CRON_SECRET so it can't be triggered by
// anyone else.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { buildReportForCompanyWeek, mondayOf, toISODate } from './equipmentreports.js';
import { buildTimeClockReportForCompanyWeek } from './companydata.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Hash-then-compare so mismatched-length headers never short-circuit —
// timingSafeEqual itself throws on unequal-length buffers, and fixed-length
// digests sidestep that while still comparing in constant time.
function safeEqual(a, b) {
  const ah = crypto.createHash('sha256').update(String(a)).digest();
  const bh = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ah, bh);
}

async function isDocKeyActive(companyId, documentKey) {
  const { data: settingRows } = await supabaseAdmin
    .from('company_document_settings')
    .select('is_active')
    .eq('company_id', companyId)
    .eq('document_key', documentKey)
    .limit(1);
  return settingRows && settingRows.length > 0 ? settingRows[0].is_active : true;
}

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (!process.env.CRON_SECRET || !authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const now = new Date();
    const thisMonday = mondayOf(now);
    const lastMonday = new Date(thisMonday); lastMonday.setDate(lastMonday.getDate() - 7);
    const weekStartISO = toISODate(lastMonday);
    const weekEndExclusiveISO = thisMonday.toISOString();

    const { data: companies, error: coErr } = await supabaseAdmin.from('companies').select('id, roster_enabled');
    if (coErr) return res.status(500).json({ error: 'Could not load companies.' });

    const equipmentResults = [];
    const timeClockResults = [];

    for (const c of companies || []) {
      // ── Weekly equipment usage report ──────────────────────────────
      try {
        const isActive = await isDocKeyActive(c.id, 'equipment_reports');
        if (!isActive) { equipmentResults.push({ companyId: c.id, skipped: true, reason: 'deactivated' }); }
        else {
          const reportJson = await buildReportForCompanyWeek(c.id, lastMonday.toISOString(), weekEndExclusiveISO);
          if (!reportJson.equipment || reportJson.equipment.length === 0) {
            equipmentResults.push({ companyId: c.id, skipped: true });
          } else {
            const { error: upsertErr } = await supabaseAdmin
              .from('equipment_reports')
              .upsert(
                { company_id: c.id, week_start: weekStartISO, week_end: reportJson.weekEnd, report_json: reportJson, pdf_url: null, generated_by: 'auto' },
                { onConflict: 'company_id,week_start' }
              );
            equipmentResults.push({ companyId: c.id, ok: !upsertErr, error: upsertErr?.message });
          }
        }
      } catch (e) {
        equipmentResults.push({ companyId: c.id, ok: false, error: e.message });
      }

      // ── Weekly time clock report (roster companies only) ────────────
      try {
        if (!c.roster_enabled) { timeClockResults.push({ companyId: c.id, skipped: true, reason: 'no_roster' }); continue; }
        const isActive = await isDocKeyActive(c.id, 'timeclock');
        if (!isActive) { timeClockResults.push({ companyId: c.id, skipped: true, reason: 'deactivated' }); continue; }

        const reportJson = await buildTimeClockReportForCompanyWeek(c.id, lastMonday.toISOString(), weekEndExclusiveISO);
        if (!reportJson.entries || reportJson.entries.length === 0) {
          timeClockResults.push({ companyId: c.id, skipped: true, reason: 'no_entries' });
          continue;
        }
        const { error: upsertErr } = await supabaseAdmin
          .from('timeclock_reports')
          .upsert(
            { company_id: c.id, week_start: weekStartISO, week_end: reportJson.weekEnd, report_json: reportJson, pdf_url: null, generated_by: 'auto' },
            { onConflict: 'company_id,week_start' }
          );
        timeClockResults.push({ companyId: c.id, ok: !upsertErr, error: upsertErr?.message });
      } catch (e) {
        timeClockResults.push({ companyId: c.id, ok: false, error: e.message });
      }
    }

    return res.status(200).json({ ok: true, weekStart: weekStartISO, equipmentResults, timeClockResults });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Cron job failed.' });
  }
}
