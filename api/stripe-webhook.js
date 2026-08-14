// api/stripe-webhook.js
// Stripe webhook endpoint — registered in the Stripe Dashboard as this
// file's URL. Listens for checkout.session.completed (stages the purchased
// plan tier + Stripe customer id, keyed by Checkout Session id, for
// submit_onboarding_intake to claim) and customer.subscription.updated/
// deleted (keeps a company's suspended flag + stripe_subscription_status in
// sync). Previously shared api/cron-equipment-reports.js with the weekly
// cron job to stay under Vercel's Hobby-plan 12-function cap; split back out
// once the project moved to Pro (see vercel-function-budget-guardian.md).
//
// IMPORTANT: if you're seeing this file for the first time after this split
// shipped, the Stripe Dashboard's webhook endpoint URL still needs to be
// updated by hand from /api/cron-equipment-reports to /api/stripe-webhook —
// that configuration lives outside this repo and nothing here can update it
// automatically. Until it's updated, Stripe events stop arriving.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Required to verify Stripe's signature against the raw payload.
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

export default async function handler(req, res) {
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
