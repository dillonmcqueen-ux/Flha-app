// api/checkout.js
// Turns a module selection from the public pricing page into a Stripe
// Checkout Session and sends the visitor straight there.
//
// Why a GET that redirects rather than a POST returning JSON: the marketing
// site (website/) is a separate Vercel project with no API routes of its
// own, so any call from it is cross-origin. A plain link avoids CORS
// entirely, works if the page's JavaScript never runs, and survives being
// copied or bookmarked. The trade is a GET with a side effect, which is
// acceptable here because creating a Checkout Session charges nobody and
// leaves nothing behind but an abandoned session.
//
// The query string chooses WHICH modules, never what they cost. Every
// amount is built server-side from server-lib/pricing.js, so editing the URL
// can only change the selection, and the price follows it. There is no
// amount, total or currency parameter to tamper with.
//
// On success Stripe returns the visitor to /onboarding?session_id=... where
// src/Onboarding.jsx picks the id up, and api/stripe-webhook.js has by then
// staged the purchase (tier, customer, modules) in stripe_checkouts for
// submit_onboarding_intake to claim. Nothing here creates a company: that
// still happens only on approval, per server-lib/onboardingApproval.js.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import {
  isTier, resolveModules, quote, buildCheckoutLineItems,
} from '../server-lib/pricing.js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// This endpoint is unauthenticated by necessity: a prospect has no account
// yet. Scripted, it is a way to make FORA's Stripe account create sessions
// indefinitely, so it gets the same per-IP fixed window as the other
// unauthenticated onboarding endpoints. A real buyer needs one or two
// attempts, not forty.
const CHECKOUT_THROTTLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const CHECKOUT_MAX_PER_HOUR = 20;

function clientIp(req) {
  // Matches api/login.js: prefer the header Vercel sets itself, and take the
  // RIGHTMOST x-forwarded-for entry, since the proxy appends the real peer
  // and the leftmost entry is whatever the caller put there.
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

async function checkIpThrottle(key, maxAttempts, windowMs) {
  const now = Date.now();
  const { data: rows } = await supabaseAdmin
    .from('master_code_ip_limits')
    .select('window_start, count')
    .eq('ip', key)
    .limit(1);
  const row = rows && rows[0];
  if (!row || now - new Date(row.window_start).getTime() > windowMs) {
    await supabaseAdmin
      .from('master_code_ip_limits')
      .upsert({ ip: key, window_start: new Date(now).toISOString(), count: 1 });
    return true;
  }
  if (row.count >= maxAttempts) return false;
  await supabaseAdmin.from('master_code_ip_limits').update({ count: row.count + 1 }).eq('ip', key);
  return true;
}

// Where Stripe sends the buyer afterwards.
//
// Deliberately NOT derived from the request. An earlier version fell back to
// x-forwarded-host, which a non-browser client can set to anything: curl this
// endpoint with X-Forwarded-Host: evil.example and Stripe mints a genuine,
// FORA-branded Checkout Session whose success_url is on the attacker's host.
// Send that real checkout link to a prospect, let them pay, and the redirect
// hands the attacker the Checkout Session id, which api/login.js treats as
// proof of purchase. The victim pays and the attacker gets the company.
//
// So: configuration or the hardcoded production origin, and nothing else. A
// preview deployment that wants to test the full round trip sets APP_ORIGIN;
// unset, it redirects to production, which is wrong for testing but never
// unsafe.
const DEFAULT_APP_ORIGIN = 'https://portal.forafieldsolutions.com';

function appOrigin() {
  const configured = (process.env.APP_ORIGIN || '').trim();
  if (!configured) return DEFAULT_APP_ORIGIN;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:') return DEFAULT_APP_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

// A visitor who lands here with a bad selection gets sent back to the
// pricing page with a message rather than a raw JSON error, since they
// arrived by clicking a button on a marketing site.
function bounce(res, message) {
  const url = `https://forafieldsolutions.com/pricing.html?error=${encodeURIComponent(message)}#build`;
  res.setHeader('Location', url);
  return res.status(303).end();
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const src = req.method === 'GET' ? (req.query || {}) : (req.body || {});
  const tier = String(src.tier || '').trim().toLowerCase();
  if (!isTier(tier)) return bounce(res, 'Pick a team size first.');

  const { modules, error: moduleError } = resolveModules(src.modules);
  if (moduleError) return bounce(res, moduleError);

  const allowed = await checkIpThrottle(
    `checkout:${clientIp(req)}`, CHECKOUT_MAX_PER_HOUR, CHECKOUT_THROTTLE_WINDOW_MS
  );
  if (!allowed) {
    return bounce(res, 'Too many checkout attempts. Please wait a few minutes, or email us.');
  }

  const { monthly, setup } = quote(tier, modules);
  const { lineItems } = buildCheckoutLineItems(tier, modules);
  const origin = appOrigin();

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      // Recurring lines plus the one-time setup fee, which rides in
      // line_items as a non-recurring price. Checkout has no
      // add_invoice_items parameter; see server-lib/pricing.js.
      line_items: lineItems,
      subscription_data: {
        metadata: { tier, modules: modules.join(',') },
      },
      // Read back by api/stripe-webhook.js on checkout.session.completed and
      // staged into stripe_checkouts. plan_tier keeps its existing name
      // because api/login.js and the companies table already speak it.
      metadata: {
        plan_tier: tier,
        modules: modules.join(','),
        quoted_monthly: String(monthly),
        quoted_setup: String(setup),
      },
      success_url: `${origin}/onboarding?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: 'https://forafieldsolutions.com/pricing.html#build',
      billing_address_collection: 'required',
      allow_promotion_codes: false,
      client_reference_id: `${tier}:${modules.join('+')}`,
    });

    res.setHeader('Location', session.url);
    return res.status(303).end();
  } catch (err) {
    console.error('Checkout session creation failed:', err.message);
    return bounce(res, 'Could not start checkout. Please email us and we will sort it out.');
  }
}
