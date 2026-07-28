// api/cron-equipment-reports.js
// Hit automatically by Vercel Cron every Monday morning. Generates last
// week's equipment usage report AND time clock report for every company
// (the latter only for companies on individual roster logins). Both jobs
// live in one file/function to stay under Vercel's serverless function
// count limit. Protected by CRON_SECRET so it can't be triggered by
// anyone else.
//
// Also doubles as the Stripe webhook endpoint (registered in Stripe as
// this file's URL), for the same function-count reason — this handler
// never reads req.body itself, so disabling Vercel's body parser below
// (required to verify Stripe's signature against the raw payload) has no
// effect on the cron path. Requests are told apart by the presence of a
// `stripe-signature` header, which only Stripe ever sends.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import Stripe from 'stripe';
import { buildReportForCompanyWeek, mondayOf, toISODate } from './equipmentreports.js';
import { buildTimeClockReportForCompanyWeek } from './companydata.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// active/trialing -> access restored; canceled/unpaid/incomplete_expired ->
// suspend. Anything else (e.g. past_due) is left alone: Stripe is still
// retrying the payment, so we don't cut access during that grace period.
const SUSPEND_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired']);
const RESTORE_STATUSES = new Set(['active', 'trialing']);

async function syncSubscriptionToCompany(subscription) {
  const status = subscription.status;
  const updates = {
    stripe_subscription_id: subscription.id,
    stripe_subscription_status: status,
  };
  if (SUSPEND_STATUSES.has(status)) updates.suspended = true;
  else if (RESTORE_STATUSES.has(status)) updates.suspended = false;

  await supabaseAdmin
    .from('companies')
    .update(updates)
    .eq('stripe_customer_id', subscription.customer);
}

async function handleStripeWebhook(req, res) {
  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  // Idempotency: Stripe retries on timeout/non-2xx, and can occasionally
  // deliver the same event twice even on success.
  const { error: dupeCheckErr } = await supabaseAdmin
    .from('stripe_webhook_events')
    .insert({ id: event.id, type: event.type });
  if (dupeCheckErr) {
    if (dupeCheckErr.code === '23505') return res.status(200).json({ ok: true, duplicate: true });
    return res.status(500).json({ error: 'Could not record event.' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await supabaseAdmin.from('stripe_checkouts').upsert({
        session_id: session.id,
        customer_id: session.customer || null,
        subscription_id: session.subscription || null,
        plan_tier: session.metadata?.plan_tier || null,
        email: session.customer_details?.email || null,
      });
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await syncSubscriptionToCompany(event.data.object);
    }
  } catch (e) {
    return res.status(500).json({ error: 'Webhook handling failed.' });
  }

  return res.status(200).json({ ok: true });
}

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
  if (req.headers['stripe-signature']) return handleStripeWebhook(req, res);

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
