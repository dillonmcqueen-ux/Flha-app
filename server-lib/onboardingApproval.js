// server-lib/onboardingApproval.js
// Shared "turn an onboarding_requests row into a real company" logic —
// used by both the admin's manual approve click (api/admin.js's
// approve_onboarding_request) and the server-side auto-approve path
// (api/login.js's submit_onboarding_intake, for requests that meet every
// "clean" criterion below). Kept in one place so the two paths can never
// silently diverge on how a company actually gets created, the same
// reason server-lib/onboardingHelpers.js centralizes site/user parsing.
// Lives outside api/ on purpose — see server-lib/uploadUrls.js for why
// (it doesn't count against Vercel's per-function budget there).
//
// ── Auto-approve criteria (all must hold — see
// .claude/agents/onboarding-automation-builder.md for the full spec this
// implements) ───────────────────────────────────────────────────────────
//   - customRequest is empty — any custom-build/custom-form ask always
//     needs bespoke human work.
//   - usersList parsed with zero skippedUserLines (sitesList has no
//     analogous failure mode: every non-blank line is already accepted as
//     a site name, and validateOnboardingIntake already hard-rejects an
//     empty sitesList before a row is ever saved, so nothing further to
//     check there).
//   - The request claimed a stripe_checkouts row (stripe_customer_id +
//     plan_tier populated) at submit time.
//   - That Stripe customer's subscription status is 'active' right now
//     (not just "a checkout session exists").
//   - No other onboarding_requests row with the same stripe_customer_id
//     has already been auto-approved (status === 'auto_approved') — one
//     auto-provisioned company per Stripe customer.
// Anything failing any check falls through to the manual Admin Panel
// queue unchanged — this module never decides to skip a company creation
// step, only whether a human has to click the button first.

import crypto from 'crypto';
import { parseSiteLines, parseUserLines, randomToken } from './onboardingHelpers.js';
import { runOnboardingDrafts } from './onboardingDrafting.js';
import { sendEmail, siteOrigin } from './email.js';

export const CLAIM_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function genAccountNumber() {
  return Math.floor(100000 + Math.random() * 900000);
}

export function genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

export function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

// Same shape as the manual "Onboard Company" flow's suggested code, for
// when a company is created automatically from an onboarding request
// instead of typed in by hand.
function randomSuffix(len = 3) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function codePrefix(name) {
  const clean = (name || '').trim().toUpperCase();
  if (!clean) return 'CO';
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3);
  return words.map(w => w[0]).join('').slice(0, 3);
}
function genPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// Looks up the given Stripe customer's most recent subscription the same
// way approve_onboarding_request already did before this refactor, and
// reports whether it's currently 'active'. Never throws — a lookup
// failure (network, bad customer id, no Stripe key configured) just means
// "not verified active", which is the fail-safe direction for an
// auto-approve gate.
export async function checkStripeSubscriptionActive(stripe, customerId) {
  if (!stripe || !customerId) return false;
  try {
    const subs = await stripe.subscriptions.list({ customer: customerId, limit: 1 });
    const sub = subs.data[0];
    return !!sub && sub.status === 'active';
  } catch (e) {
    console.error('Stripe subscription lookup failed for auto-approve check:', e.message);
    return false;
  }
}

// Evaluates every auto-approve criterion for one onboarding_requests row.
// `request` must include: id, custom_request, stripe_customer_id,
// plan_tier. `skippedUserLines` is whatever the caller's own
// parseUserLines(request.users_list) call already produced (both
// api/login.js and api/admin.js already run that parse for their own
// reasons, so this takes it as an argument rather than re-parsing).
export async function canAutoApprove(supabaseAdmin, stripe, request, skippedUserLines) {
  if ((request.custom_request || '').trim()) return false;
  if (skippedUserLines && skippedUserLines.length > 0) return false;
  if (!request.stripe_customer_id || !request.plan_tier) return false;

  const active = await checkStripeSubscriptionActive(stripe, request.stripe_customer_id);
  if (!active) return false;

  const { data: dup, error } = await supabaseAdmin
    .from('onboarding_requests')
    .select('id')
    .eq('stripe_customer_id', request.stripe_customer_id)
    .eq('status', 'auto_approved')
    .neq('id', request.id || 0)
    .limit(1);
  if (error) return false; // fail safe — an unreadable dup-check falls through to manual review
  if (dup && dup.length > 0) return false;

  return true;
}

// Creates the company from an onboarding_requests row — company +
// account number, sites, a placeholder roster (real PINs are assigned by
// the contact on the claim-link page, never generated/emailed here), the
// claim token, and a best-effort claim-link email. Never auto-creates
// equipment or SOPs — those stay AI-drafted-but-unsaved until the contact
// confirms them (see runOnboardingDrafts / claim_confirm_equipment /
// claim_confirm_sops in api/login.js).
//
// `autoApproved` only changes what status gets stamped on the request
// (so the Admin Panel can tell "a human clicked approve" apart from "the
// system did" and so canAutoApprove's dup-check works) — every other step
// is identical regardless of who/what triggered it.
export async function provisionCompanyFromRequest(supabaseAdmin, stripe, req, request, { autoApproved = false } = {}) {
  const prefix = codePrefix(request.company_name);
  let companyCode = '';
  for (let tries = 0; tries < 8; tries++) {
    const candidate = `${prefix}${randomSuffix()}`;
    const { data: clash } = await supabaseAdmin.from('companies').select('id').eq('company_code', candidate).limit(1);
    if (!clash || clash.length === 0) { companyCode = candidate; break; }
  }
  if (!companyCode) return { error: "Couldn't generate a unique company code. Try again." };

  let acct = genAccountNumber();
  for (let tries = 0; tries < 5; tries++) {
    const { data: clash } = await supabaseAdmin.from('companies').select('id').eq('account_number', acct).limit(1);
    if (!clash || clash.length === 0) break;
    acct = genAccountNumber();
  }

  const { data: companyRows, error: coErr } = await supabaseAdmin.from('companies').insert({
    name: request.company_name.trim(),
    company_code: companyCode,
    account_number: acct,
    contact_name: request.contact_name || null,
    contact_email: request.contact_email || null,
    contact_phone: request.contact_phone || null,
    address: request.address || null,
    logo_url: request.logo_url || null,
    ...(['basic', 'advanced'].includes(request.plan_tier) ? { plan_tier: request.plan_tier } : {}),
    stripe_customer_id: request.stripe_customer_id || null,
  }).select('id').limit(1);
  if (coErr) return { error: "Couldn't create company: " + coErr.message };
  const companyId = companyRows[0].id;

  // Best-effort: this request came from a paid checkout, so pick up the
  // subscription it created and stamp its status — lets the webhook
  // (api/stripe-webhook.js) start syncing this company on the very next
  // subscription event instead of only after one arrives from scratch.
  if (stripe && request.stripe_customer_id) {
    try {
      const subs = await stripe.subscriptions.list({ customer: request.stripe_customer_id, limit: 1 });
      const sub = subs.data[0];
      if (sub) {
        await supabaseAdmin.from('companies').update({
          stripe_subscription_id: sub.id,
          stripe_subscription_status: sub.status,
        }).eq('id', companyId);
      }
    } catch (e) {
      console.error('Could not look up Stripe subscription for approved company:', e.message);
    }
  }

  const siteNames = parseSiteLines(request.sites_list);
  if (siteNames.length > 0) {
    await supabaseAdmin.from('sites').insert(siteNames.map(name => ({ company_id: companyId, name })));
  }

  const { roster: parsedRoster, skippedUserLines } = parseUserLines(request.users_list);
  const roster = parsedRoster.map(({ name, role }) => {
    const salt = genSalt();
    // Randomly generated and never surfaced anywhere below — this row
    // only exists so the company has an active roster from minute one;
    // the actual PIN a person will use is whatever the contact sets for
    // them on the claim-link page.
    return { company_id: companyId, name, role, pin_hash: hashPin(genPin(), salt), pin_salt: salt, active: true };
  });
  if (roster.length > 0) {
    const { error: rosterErr } = await supabaseAdmin.from('roster').insert(roster);
    if (!rosterErr) await supabaseAdmin.from('companies').update({ roster_enabled: true }).eq('id', companyId);
  }

  const claimToken = randomToken();
  const claimTokenExpiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MS).toISOString();
  await supabaseAdmin.from('onboarding_requests').update({
    status: autoApproved ? 'auto_approved' : 'in_progress',
    created_company_id: companyId,
    claim_token: claimToken,
    claim_token_expires_at: claimTokenExpiresAt,
    draft_status: 'pending',
  }).eq('id', request.id);

  // Credential delivery — a self-serve claim link, not emailed PINs.
  // Best-effort: the company is already created either way, so a failed
  // email here doesn't undo anything.
  let claimEmailSent = false;
  if (request.contact_email) {
    try {
      await sendEmail({
        to: request.contact_email,
        subject: `Your FORA account is ready — ${request.company_name}`,
        text: [
          `Your company code: ${companyCode}`,
          '',
          `Finish setup — assign PINs to your team, and review the equipment/SOPs we drafted from what you sent:`,
          `${siteOrigin(req)}/claim?token=${claimToken}`,
          '',
          'This link works for the next 14 days.',
        ].join('\n'),
      });
      claimEmailSent = true;
    } catch (e) {
      console.error('Claim-link email failed:', e.message);
    }
  }

  // Post-approval automation, fire-and-forget: kicks off the AI draft of
  // equipment (from units_list), SOPs (from the uploaded files), and now
  // a first-pass company profile (docs/scope-company-brain.md, Phase 2)
  // now that the company exists, without making the caller wait on an LLM
  // call. Deliberately not awaited — see the top-of-file comment in
  // onboardingDrafting.js. Errors are caught inside runOnboardingDrafts.
  // created_company_id is passed explicitly here — `request` is the
  // in-memory row from before this function's own company-creation
  // update above, so it doesn't have that column set yet; without this,
  // the company profile draft (which needs a company_id to attach to)
  // would silently never run on this call path.
  runOnboardingDrafts(supabaseAdmin, { ...request, id: request.id, created_company_id: companyId }).catch(e => {
    console.error('Background onboarding draft generation failed:', e.message);
  });

  return {
    companyId,
    companyCode,
    sitesCreated: siteNames.length,
    rosterCreated: roster.length,
    skippedUserLines,
    claimEmailSent,
  };
}
