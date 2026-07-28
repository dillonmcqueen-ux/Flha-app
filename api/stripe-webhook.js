// api/stripe-webhook.js
// Receives Stripe events for the two Payment Links on the pricing page.
// A checkout finishes before the customer has an account or a company —
// they land on /onboarding right after paying — so this just stages what
// was purchased (api's submit_onboarding_intake claims it by session id)
// and keeps existing companies' subscription state in sync so a lapsed or
// canceled subscription suspends access automatically.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
