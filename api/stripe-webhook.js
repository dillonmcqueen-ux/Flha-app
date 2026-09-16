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

  // As with the staging write below: supabase-js reports a database failure
  // as { error } rather than throwing, so this has to be checked explicitly
  // or a failed sync silently reports success and Stripe never retries it.
  const { error } = await supabaseAdmin
    .from('companies')
    .update(updates)
    .eq('stripe_customer_id', subscription.customer);
  if (error) throw new Error(`companies subscription sync failed: ${error.message}`);
}

// Whether a delivery should be processed, skipped as a genuine duplicate,
// or failed. Split out from the handler so the decision is testable without
// a database: the bug this replaced lived entirely here, and was invisible
// to every test because it only shows up on the second delivery of an event
// whose first delivery failed.
//
//   claimErr null              -> first delivery, process
//   claimErr 23505, processed  -> finished already, genuine duplicate
//   claimErr 23505, unfinished -> earlier attempt died, process again
//   claimErr anything else     -> could not claim, fail so Stripe retries
export function claimOutcome(claimErr, prior) {
  if (!claimErr) return 'process';
  if (claimErr.code !== '23505') return 'error';
  return prior?.processed_at ? 'duplicate' : 'process';
}

export default async function handler(req, res) {
  let event;
  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send('Webhook signature verification failed.');
  }

  // Idempotency: Stripe retries on timeout/non-2xx, and can occasionally
  // deliver the same event twice even on success.
  //
  // The row is a CLAIM, not a record of completion. Those have to be
  // separate: this used to insert the id and then treat any later delivery
  // of it as a duplicate, so an attempt that claimed the event and then
  // failed could never be retried. Stripe's retry was told the event was
  // already handled, and the customer's purchase was never staged. A
  // timeout was the worst case, since there is no code still running to
  // undo the claim.
  //
  // So: claim first, stamp processed_at only on success, and let a retry
  // through when it finds an unfinished claim. Two concurrent deliveries
  // can both get through this way, which is fine because both handlers are
  // idempotent (the stripe_checkouts upsert is keyed on session_id, and the
  // company sync is a plain update).
  const { error: claimErr } = await supabaseAdmin
    .from('stripe_webhook_events')
    .insert({ id: event.id, type: event.type });

  let prior = null;
  if (claimErr?.code === '23505') {
    // Already claimed. Finished, or abandoned by a failed earlier attempt?
    const { data, error: priorErr } = await supabaseAdmin
      .from('stripe_webhook_events')
      .select('processed_at')
      .eq('id', event.id)
      .maybeSingle();
    if (priorErr) {
      console.error('Could not read prior webhook event:', event.id, priorErr.message);
      return res.status(500).json({ error: 'Could not record event.' });
    }
    prior = data;
  }

  const outcome = claimOutcome(claimErr, prior);
  if (outcome === 'error') {
    console.error('Could not claim webhook event:', event.id, claimErr.message);
    return res.status(500).json({ error: 'Could not record event.' });
  }
  if (outcome === 'duplicate') return res.status(200).json({ ok: true, duplicate: true });

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      // `modules` is the comma-joined list api/checkout.js put on the
      // session. It decides which document types the company gets switched
      // on at approval, so it has to survive from here to
      // server-lib/onboardingApproval.js. Older sessions (the retired
      // Payment Links) carry no modules and stage NULL, which every reader
      // treats as "unknown, leave the defaults alone".
      const rawModules = session.metadata?.modules;
      const modules = typeof rawModules === 'string' && rawModules.trim()
        ? rawModules.split(',').map(m => m.trim()).filter(Boolean)
        : null;

      // supabase-js RESOLVES on a database error, it does not throw: the
      // failure arrives as { error } on the result. Ignoring it here meant a
      // failed staging write still fell through to a 200 and a processed_at
      // stamp, so Stripe never retried and the purchase was lost. Throwing
      // is what routes it into the catch below, which is what leaves the
      // claim unfinished for the retry to pick up.
      const { error: stageErr } = await supabaseAdmin.from('stripe_checkouts').upsert({
        session_id: session.id,
        customer_id: session.customer || null,
        subscription_id: session.subscription || null,
        plan_tier: session.metadata?.plan_tier || null,
        modules,
        email: session.customer_details?.email || null,
      });
      if (stageErr) throw new Error(`stripe_checkouts upsert failed: ${stageErr.message}`);
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      await syncSubscriptionToCompany(event.data.object);
    }
  } catch (e) {
    // Deliberately no processed_at stamp: the claim stays unfinished so
    // Stripe's retry reprocesses rather than being told it is a duplicate.
    // The error was previously swallowed unlogged, which made a permanently
    // lost purchase invisible as well as permanent.
    console.error('Webhook handling failed:', event.id, event.type, e.message);
    return res.status(500).json({ error: 'Webhook handling failed.' });
  }

  // Only now is the event genuinely handled.
  const { error: stampErr } = await supabaseAdmin
    .from('stripe_webhook_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', event.id);
  if (stampErr) {
    // The work is done and committed; failing here only risks Stripe
    // redelivering and us redoing idempotent work. Not worth a 500, which
    // would guarantee that redelivery rather than merely risk it.
    console.error('Could not stamp webhook event processed:', event.id, stampErr.message);
  }

  return res.status(200).json({ ok: true });
}
