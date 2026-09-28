// api/scope-approval.js
// Client-facing step of the Ted scoping pipeline (see CLAUDE.md's "Client
// scoping pipeline" section). GET renders a branded one-page approval
// screen for a single portal_scope_requests row, looked up by an
// unguessable approval_token (same trust model as onboarding_requests'
// edit_token/claim_token — a private link shared only with the one client
// it names, not HMAC-verified). POST is the client hitting "Approve" on
// that page: it creates the Stripe customer + invoice, sends it, and
// notifies Dillon. Payment confirmation itself is NOT handled here — that
// arrives later as an invoice.paid event on api/stripe-webhook.js, which
// notifies Dillon separately once money has actually moved.
//
// Unauthenticated by necessity, same reasoning as api/checkout.js: the
// client has no FORA account yet. Guarded by the same per-IP throttle
// rather than by token secrecy alone, so a leaked/forwarded link can't be
// hammered into a token-guessing oracle.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { checkIpThrottle } from '../server-lib/ipThrottle.js';
import { sendEmail } from '../server-lib/email.js';
import { sendSlackNotification } from '../server-lib/slack.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const THROTTLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_HOUR = 30; // a client reloading the page a few times is normal

function clientIp(req) {
  // Matches api/checkout.js and api/login.js: prefer the header Vercel sets
  // itself, and take the RIGHTMOST x-forwarded-for entry.
  const vercelFwd = req.headers['x-vercel-forwarded-for'];
  if (typeof vercelFwd === 'string' && vercelFwd.trim()) {
    const parts = vercelFwd.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    const parts = fwd.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return req.socket?.remoteAddress || 'unknown';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function money(cents) {
  if (cents == null) return 'TBD';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// Minimal inline styling, no external assets — matches website/design.md's
// palette (near-black ground, FORA orange accent) without pulling in the
// site's build.
function pageShell({ title, body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — FORA</title>
<style>
  body { background:#0d0d0d; color:#f2f2f2; font-family:-apple-system,Inter,Segoe UI,sans-serif; margin:0; padding:0; }
  .wrap { max-width:640px; margin:0 auto; padding:48px 24px; }
  h1 { color:#F97316; font-size:1.5rem; margin-bottom:4px; }
  .sub { color:#999; margin-top:0; }
  .card { background:#171717; border:1px solid #2a2a2a; border-radius:12px; padding:24px; margin:20px 0; }
  .row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #262626; }
  .row:last-child { border-bottom:none; }
  .label { color:#999; }
  .value { font-weight:600; }
  .scope { white-space:pre-wrap; line-height:1.5; color:#d4d4d4; }
  button { background:#F97316; color:#0d0d0d; font-weight:700; border:none; border-radius:8px; padding:14px 28px; font-size:1rem; cursor:pointer; width:100%; }
  button:hover { background:#ea6a0c; }
  .fine { color:#777; font-size:0.85rem; margin-top:16px; }
</style></head>
<body><div class="wrap">${body}</div></body></html>`;
}

export default async function handler(req, res) {
  const token = (req.query.token || '').toString().trim();
  if (!token) return res.status(400).send('Missing approval link.');

  const ip = clientIp(req);
  const allowed = await checkIpThrottle(supabaseAdmin, `scope-approval:${ip}`, MAX_PER_HOUR, THROTTLE_WINDOW_MS);
  if (!allowed) return res.status(429).send('Too many requests. Try again shortly.');

  const { data: scope, error: findErr } = await supabaseAdmin
    .from('portal_scope_requests')
    .select('*')
    .eq('approval_token', token)
    .maybeSingle();
  if (findErr) {
    console.error('scope-approval lookup failed:', findErr.message);
    return res.status(500).send('Something went wrong loading this proposal.');
  }
  if (!scope) return res.status(404).send('This proposal link is no longer valid.');

  if (req.method === 'GET') return res.status(200).send(renderScopePage(scope));
  if (req.method !== 'POST') return res.status(405).send('Method not allowed.');

  // Already moved past 'sent' — most likely the client double-clicked
  // Approve, or reloaded the confirmation page. Idempotent: show the same
  // confirmation rather than creating a second invoice.
  if (scope.status !== 'sent') {
    return res.status(200).send(renderConfirmedPage(scope));
  }

  try {
    const customer = await stripe.customers.create({
      name: scope.client_name,
      email: scope.contact_email || undefined,
      metadata: { portal_scope_request_id: scope.id },
    });

    await stripe.invoiceItems.create({
      customer: customer.id,
      currency: 'cad',
      amount: scope.setup_fee_cents,
      description: `FORA Company Portal — setup (${scope.document_count} documents, ${scope.doc_band} band)`,
    });

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: 7,
      metadata: { portal_scope_request_id: scope.id },
    });
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(finalized.id);

    const now = new Date().toISOString();
    const { error: updateErr } = await supabaseAdmin
      .from('portal_scope_requests')
      .update({
        status: 'invoiced',
        approved_at: now,
        invoiced_at: now,
        stripe_customer_id: customer.id,
        stripe_invoice_id: finalized.id,
      })
      .eq('id', scope.id);
    if (updateErr) throw new Error(`portal_scope_requests update failed: ${updateErr.message}`);

    const notifyText = `Scope approved: ${scope.client_name} approved their Portal proposal (${money(scope.setup_fee_cents)} setup). Invoice sent, due in 7 days.`;
    await Promise.allSettled([
      sendSlackNotification(notifyText),
      process.env.DILLON_NOTIFY_EMAIL
        ? sendEmail({ to: process.env.DILLON_NOTIFY_EMAIL, subject: `Scope approved: ${scope.client_name}`, text: notifyText })
        : Promise.resolve(),
    ]);

    return res.status(200).send(renderConfirmedPage({ ...scope, status: 'invoiced' }));
  } catch (e) {
    console.error('scope-approval approve failed:', scope.id, e.message);
    return res.status(500).send('Something went wrong sending your invoice. FORA has been notified — we\'ll follow up directly.');
  }
}

function renderScopePage(scope) {
  if (scope.status !== 'sent') return renderConfirmedPage(scope);
  return pageShell({
    title: `Proposal for ${scope.client_name}`,
    body: `
      <h1>FORA Company Portal</h1>
      <p class="sub">Proposal prepared for ${escapeHtml(scope.client_name)}</p>
      <div class="card scope">${escapeHtml(scope.scope_summary || 'Scope details attached separately.')}</div>
      <div class="card">
        <div class="row"><span class="label">One-time setup</span><span class="value">${money(scope.setup_fee_cents)}</span></div>
        <div class="row"><span class="label">Monthly</span><span class="value">${money(scope.monthly_fee_cents)}/mo</span></div>
        <div class="row"><span class="label">Estimated timeline</span><span class="value">${escapeHtml(scope.timeline_weeks || 'TBD')}</span></div>
      </div>
      <form method="POST">
        <button type="submit">Approve Scope</button>
      </form>
      <p class="fine">Approving sends an invoice for the setup fee, due within 7 days. Nothing is booked or built until it's paid.</p>
    `,
  });
}

function renderConfirmedPage(scope) {
  const message = scope.status === 'paid'
    ? 'Payment received — FORA will be in touch shortly to collect your documents and get started.'
    : 'Approved. An invoice for the setup fee has been sent to your email.';
  return pageShell({
    title: `Proposal for ${scope.client_name}`,
    body: `<h1>Thanks, ${escapeHtml(scope.client_name)}.</h1><p class="sub">${escapeHtml(message)}</p>`,
  });
}
