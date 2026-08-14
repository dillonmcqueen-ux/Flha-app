// api/cron-company-brain-summary.js
// Hit automatically by Vercel Cron, daily. Phase 4 of
// docs/scope-company-brain.md: rolls up recent company_signals (Phase 3)
// into each active company's company_profiles row. A separate function
// and separate schedule from api/cron-equipment-reports.js on purpose —
// different cadence (daily vs. weekly), different trigger source
// (company_signals activity vs. a fixed weekly report), and this repo is
// on Vercel's Pro plan now so there's no function-count pressure to fold
// it into an existing file (see vercel-function-budget-guardian.md).
// Protected by CRON_SECRET, same as the equipment/timeclock cron, so it
// can't be triggered by anyone else.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { runCompanyBrainSummary } from '../server-lib/companyBrainSummary.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Hash-then-compare so mismatched-length headers never short-circuit —
// same reasoning as api/cron-equipment-reports.js's safeEqual.
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

  try {
    const result = await runCompanyBrainSummary(supabaseAdmin);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Cron job failed.' });
  }
}
