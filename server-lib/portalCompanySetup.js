// server-lib/portalCompanySetup.js
// Setup path for a FORA Field Portal engagement, after its setup invoice is
// paid (see CLAUDE.md's "Client scoping pipeline" section).
//
// Two jobs, both idempotent:
//
//   provisionPortalCompany    the company shell Dillon builds documents into.
//                             Platform document types all OFF, roster_enabled
//                             on, the scope's contact seeded as the Account
//                             Owner. Run from the Admin Panel button
//                             (api/admin.js create_portal_company), never
//                             automatically.
//   ensurePortalSubscription  the monthly fee. Started by api/stripe-webhook.js
//                             when the setup invoice is paid, billed as a
//                             Stripe invoice (no card on file), first one a
//                             fixed number of days after payment.
//
// Nothing here emails the client. The Owner's PIN-setup link goes out later,
// when Dillon clicks "Send setup links" on the roster after the documents are
// built.

import { genAccountNumber, genSalt, hashPin, genPin, codePrefix, randomSuffix } from './onboardingApproval.js';
import { planRoster } from './onboardingRoster.js';
import { documentSettingsFor } from './pricing.js';
import { encryptField } from './fieldCrypto.js';

// How long after the setup invoice is paid the first monthly invoice goes out.
// One place so changing the billing start is a one line edit.
export const PORTAL_FIRST_INVOICE_DELAY_DAYS = 30;
export const PORTAL_INVOICE_DAYS_UNTIL_DUE = 7;

const fail = (status, error) => ({ ok: false, status, error });

// The Owner a scope would seed, or null when the scope has no contact email.
// Reuses the onboarding roster rules so an Owner is built the same way for
// every company: a supervisor, flagged is_owner.
export function portalOwnerFor(scope) {
  const plan = planRoster([], new Map(), { name: scope.contact_name, email: scope.contact_email });
  return plan.find((p) => p.isOwner) || null;
}

async function freeCompanyCode(supabaseAdmin, name) {
  const prefix = codePrefix(name);
  for (let tries = 0; tries < 8; tries++) {
    const candidate = `${prefix}${randomSuffix(5)}`;
    const { data: clash } = await supabaseAdmin.from('companies').select('id').ilike('company_code', candidate).limit(1);
    if (!clash || clash.length === 0) return candidate;
  }
  return null;
}

async function freeAccountNumber(supabaseAdmin) {
  let acct = genAccountNumber();
  for (let tries = 0; tries < 5; tries++) {
    const { data: clash } = await supabaseAdmin.from('companies').select('id').eq('account_number', acct).limit(1);
    if (!clash || clash.length === 0) break;
    acct = genAccountNumber();
  }
  return acct;
}

// Switch every Platform document type off, as explicit rows. A missing row
// resolves OFF anyway; writing the rows records that it was a decision, the
// same reason checkout-provisioned companies get explicit rows.
async function applyDocumentSettings(supabaseAdmin, companyId) {
  const { error } = await supabaseAdmin
    .from('company_document_settings')
    .upsert(documentSettingsFor(companyId, []), { onConflict: 'company_id,document_key' });
  return error || null;
}

// Seeds the Account Owner when the company has none yet, and turns the roster on.
async function ensureOwner(supabaseAdmin, companyId, owner) {
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('roster').select('id').eq('company_id', companyId).eq('is_owner', true).limit(1);
  if (findErr) return findErr;
  if (!existing || existing.length === 0) {
    const salt = genSalt();
    // Never surfaced: the Owner chooses their own PIN from the setup link.
    const { data: made, error } = await supabaseAdmin.from('roster').insert({
      company_id: companyId, name: owner.name, role: owner.role, is_owner: true, active: true,
      pin_hash: hashPin(genPin(), salt), pin_salt: salt,
      email: owner.email ? encryptField(owner.email) : null,
      title: owner.title || null, departments: [], divisions: [],
    }).select('id');
    if (error) return error;
    // roster has no unique constraint on is_owner, so two runs at once could
    // both pass the check above. Keep the lowest id and remove ours if we lost.
    const { data: owners } = await supabaseAdmin.from('roster').select('id').eq('company_id', companyId).eq('is_owner', true).order('id', { ascending: true });
    const myId = made?.[0]?.id;
    if (myId != null && owners && owners.length > 1 && owners[0].id !== myId) {
      await supabaseAdmin.from('roster').delete().eq('id', myId).eq('company_id', companyId);
    }
  }
  const { error: rosterOnErr } = await supabaseAdmin.from('companies').update({ roster_enabled: true }).eq('id', companyId);
  return rosterOnErr || null;
}

// Builds (or finishes building) the company for a paid scope. Safe to run
// twice: a second run finds the linked company and only repairs what is
// missing. `stripe` is optional and only used to copy the subscription status
// onto the company.
export async function provisionPortalCompany(supabaseAdmin, stripe, scopeId) {
  const { data: scope, error: findErr } = await supabaseAdmin
    .from('portal_scope_requests')
    .select('id, client_name, contact_name, contact_email, tier, status, stripe_customer_id, stripe_subscription_id, company_id')
    .eq('id', scopeId)
    .maybeSingle();
  if (findErr) return fail(500, 'Could not load that Portal engagement.');
  if (!scope) return fail(404, 'Portal engagement not found.');
  if (scope.status !== 'paid') return fail(400, 'The setup invoice has to be paid before the company is created.');

  const owner = portalOwnerFor(scope);
  if (!owner) return fail(400, 'This engagement has no contact email, so there is no Account Owner to seed. Add one to the proposal first.');

  const warnings = [];
  let companyId = scope.company_id;
  let companyCode = null;
  let created = false;

  if (!companyId) {
    // syncSubscriptionToCompany matches companies on stripe_customer_id, so two
    // companies sharing one would suspend or restore each other.
    if (scope.stripe_customer_id) {
      const { data: shared } = await supabaseAdmin.from('companies').select('id').eq('stripe_customer_id', scope.stripe_customer_id).limit(1);
      if (shared && shared.length > 0) return fail(409, 'Another company already uses this engagement\'s Stripe customer. Sort that out in Stripe before creating the company.');
    }
    companyCode = await freeCompanyCode(supabaseAdmin, scope.client_name);
    if (!companyCode) return fail(500, "Couldn't generate a unique company code. Try again.");
    const accountNumber = await freeAccountNumber(supabaseAdmin);

    const { data: rows, error: coErr } = await supabaseAdmin.from('companies').insert({
      name: scope.client_name.trim(),
      company_code: companyCode,
      account_number: accountNumber,
      contact_name: scope.contact_name || null,
      contact_email: scope.contact_email || null,
      ...(['basic', 'advanced'].includes(scope.tier) ? { plan_tier: scope.tier } : {}),
      stripe_customer_id: scope.stripe_customer_id || null,
    }).select('id').limit(1);
    if (coErr || !rows?.[0]) {
      console.error('provisionPortalCompany: company insert failed:', coErr?.message);
      return fail(500, "Couldn't create the company. Try again.");
    }
    companyId = rows[0].id;

    // Claim the scope before anything else is written, so a double click or a
    // second tab cannot leave two companies behind one engagement.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('portal_scope_requests')
      .update({ company_id: companyId })
      .eq('id', scope.id)
      .is('company_id', null)
      .select('id');
    if (claimErr || !claimed || claimed.length === 0) {
      // Lost the race (or could not record the link). The company above was
      // created a moment ago by this call and has no other data, so it is the
      // only row removed.
      await supabaseAdmin.from('companies').delete().eq('id', companyId);
      if (claimErr) return fail(500, "Couldn't link the company to the engagement. Try again.");
      return fail(409, 'Another request already created this engagement\'s company. Refresh and look for it in the company list.');
    }
    created = true;
  } else {
    const { data: co } = await supabaseAdmin.from('companies').select('company_code').eq('id', companyId).maybeSingle();
    companyCode = co?.company_code || null;
  }

  const settingsErr = await applyDocumentSettings(supabaseAdmin, companyId);
  if (settingsErr) {
    console.error('provisionPortalCompany: document settings failed:', settingsErr.message);
    warnings.push('Platform document types could not be switched off. Check the document toggles before anyone logs in.');
  }

  const ownerErr = await ensureOwner(supabaseAdmin, companyId, owner);
  if (ownerErr) {
    console.error('provisionPortalCompany: owner seed failed:', ownerErr.message);
    warnings.push('The Account Owner could not be created. Run Set up Portal company again.');
  }

  // Best-effort: carry the subscription (if the webhook already started one)
  // onto the company so the suspend/restore sync has the id from day one.
  if (stripe && scope.stripe_subscription_id) {
    try {
      const sub = await stripe.subscriptions.retrieve(scope.stripe_subscription_id);
      await supabaseAdmin.from('companies').update({
        stripe_subscription_id: sub.id,
        stripe_subscription_status: sub.status,
      }).eq('id', companyId);
    } catch (e) {
      console.error('provisionPortalCompany: could not read the subscription:', e.message);
    }
  }

  return { ok: true, status: 200, companyId, companyCode, created, ownerName: owner.name, warnings };
}

// Starts the monthly subscription for a paid scope, once. Called on every
// delivery of the setup invoice's paid event, so a failure after the paid
// stamp is retried by Stripe instead of lost. Throws on a Stripe or database
// failure (the webhook turns that into a 500 and a retry); returns a reason
// string when there is nothing to do.
export async function ensurePortalSubscription(stripe, supabaseAdmin, scope, now = Date.now()) {
  if (scope.stripe_subscription_id) return { started: false, reason: 'already started' };
  if (!scope.monthly_fee_cents || scope.monthly_fee_cents <= 0) return { started: false, reason: 'no monthly fee' };
  if (!scope.stripe_customer_id) throw new Error(`portal scope ${scope.id} has no Stripe customer`);

  const product = await stripe.products.create(
    { name: 'FORA Field Portal monthly', metadata: { portal_scope_request_id: scope.id } },
    { idempotencyKey: `portal-product-${scope.id}` },
  );
  const firstInvoiceAt = Math.floor((now + PORTAL_FIRST_INVOICE_DELAY_DAYS * 24 * 60 * 60 * 1000) / 1000);
  const sub = await stripe.subscriptions.create(
    {
      customer: scope.stripe_customer_id,
      collection_method: 'send_invoice',
      days_until_due: PORTAL_INVOICE_DAYS_UNTIL_DUE,
      trial_end: firstInvoiceAt,
      items: [{ price_data: { currency: 'cad', product: product.id, unit_amount: scope.monthly_fee_cents, recurring: { interval: 'month' } } }],
      metadata: { portal_scope_request_id: scope.id },
    },
    { idempotencyKey: `portal-sub-${scope.id}` },
  );

  const { error } = await supabaseAdmin
    .from('portal_scope_requests')
    .update({ stripe_subscription_id: sub.id })
    .eq('id', scope.id);
  if (error) throw new Error(`portal_scope_requests subscription update failed: ${error.message}`);

  if (scope.company_id) {
    const { error: coErr } = await supabaseAdmin
      .from('companies')
      .update({ stripe_subscription_id: sub.id, stripe_subscription_status: sub.status })
      .eq('id', scope.company_id);
    if (coErr) throw new Error(`companies subscription update failed: ${coErr.message}`);
  }
  return { started: true, subscriptionId: sub.id, firstInvoiceAt };
}
