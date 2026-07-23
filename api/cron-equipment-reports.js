// api/cron-equipment-reports.js
// Hit automatically by Vercel Cron every Monday morning. Generates last
// week's equipment usage report for every company. Protected by CRON_SECRET
// so it can't be triggered by anyone else.

import { createClient } from '@supabase/supabase-js';
import { buildReportForCompanyWeek, mondayOf, toISODate } from './equipmentreports.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const now = new Date();
    const thisMonday = mondayOf(now);
    const lastMonday = new Date(thisMonday); lastMonday.setDate(lastMonday.getDate() - 7);
    const weekStartISO = toISODate(lastMonday);
    const weekEndExclusiveISO = thisMonday.toISOString();

    const { data: companies, error: coErr } = await supabaseAdmin.from('companies').select('id');
    if (coErr) return res.status(500).json({ error: 'Could not load companies.' });

    const results = [];
        for (const c of companies || []) {
      try {
        const { data: settingRows } = await supabaseAdmin
          .from('company_document_settings')
          .select('is_active')
          .eq('company_id', c.id)
          .eq('document_key', 'equipment_reports')
          .limit(1);
        const isActive = settingRows && settingRows.length > 0 ? settingRows[0].is_active : true;
        if (!isActive) { results.push({ companyId: c.id, skipped: true, reason: 'deactivated' }); continue; }

        const reportJson = await buildReportForCompanyWeek(c.id, lastMonday.toISOString(), weekEndExclusiveISO);

        // Skip companies with no equipment activity that week — no point storing an empty report.
        if (!reportJson.equipment || reportJson.equipment.length === 0) {
          results.push({ companyId: c.id, skipped: true });
          continue;
        }
        const { error: upsertErr } = await supabaseAdmin
          .from('equipment_reports')
          .upsert(
            { company_id: c.id, week_start: weekStartISO, week_end: reportJson.weekEnd, report_json: reportJson, pdf_url: null, generated_by: 'auto' },
            { onConflict: 'company_id,week_start' }
          );
        results.push({ companyId: c.id, ok: !upsertErr, error: upsertErr?.message });
      } catch (e) {
        results.push({ companyId: c.id, ok: false, error: e.message });
      }
    }

    return res.status(200).json({ ok: true, weekStart: weekStartISO, results });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Cron job failed.' });
  }
}
