// api/cron-equipment-reports.js
// Hit automatically by Vercel Cron every Sunday at 11:59pm UTC. Generates
// the week-just-finished's equipment usage report AND time clock report
// for every company (the latter only for companies on individual roster
// logins). Both jobs live in one file/function since they're naturally
// related (same weekly cron, same "for every company" loop). Protected by
// CRON_SECRET so it can't be triggered by anyone else.
//
// The Stripe webhook used to share this file/URL too, for the same reason
// every dispatcher here folds actions together — the Vercel Hobby-plan
// 12-function cap. Split into its own api/stripe-webhook.js once the
// project moved to Pro (see vercel-function-budget-guardian.md). The Stripe
// Dashboard's webhook endpoint URL must be updated by hand to match — see
// that file's header comment.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { buildReportForCompanyWeek, mondayOf, toISODate } from './equipmentreports.js';
import { buildTimeClockReportForCompanyWeek } from './timeclockreports.js';

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
    // Runs Sunday 11:59pm UTC (see vercel.json), right at the close of the
    // week — `mondayOf(now)` on a Sunday resolves to the Monday that
    // started that same week, so this is already "the week that just
    // finished," not one further back.
    const now = new Date();
    const currentMonday = mondayOf(now);
    const nextMonday = new Date(currentMonday); nextMonday.setDate(nextMonday.getDate() + 7);
    const weekStartISO = toISODate(currentMonday);
    const weekEndExclusiveISO = nextMonday.toISOString();

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
          const reportJson = await buildReportForCompanyWeek(c.id, currentMonday.toISOString(), weekEndExclusiveISO);
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

        const reportJson = await buildTimeClockReportForCompanyWeek(c.id, currentMonday.toISOString(), weekEndExclusiveISO);
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
