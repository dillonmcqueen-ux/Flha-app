// The Portal setup path: a paid Portal engagement becomes a company with every
// Platform document type off, the roster on and the contact as Account Owner,
// and its monthly fee becomes a Stripe subscription billed by invoice.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './_fakeDb.js';
import { ALL_DOC_KEYS } from '../../server-lib/pricing.js';
import {
  provisionPortalCompany,
  ensurePortalSubscription,
  portalOwnerFor,
  PORTAL_FIRST_INVOICE_DELAY_DAYS,
  PORTAL_INVOICE_DAYS_UNTIL_DUE,
} from '../../server-lib/portalCompanySetup.js';

process.env.FIELD_ENCRYPTION_KEY ||= '0'.repeat(64);

const scope = (over = {}) => ({
  id: 's1', client_name: 'Prairie Pressure Control', contact_name: 'Sam Lee', contact_email: 'sam@prairie.example',
  tier: 'basic', status: 'paid', stripe_customer_id: 'cus_1', stripe_subscription_id: null, company_id: null,
  monthly_fee_cents: 4500, ...over,
});

test('a paid scope becomes a Portal-only company', async () => {
  const db = makeDb({ portal_scope_requests: [scope()] });
  const r = await provisionPortalCompany(db, null, 's1');
  assert.equal(r.ok, true);
  assert.equal(r.created, true);

  const company = db.tables.companies.find((c) => c.id === r.companyId);
  assert.equal(company.name, 'Prairie Pressure Control');
  assert.equal(company.stripe_customer_id, 'cus_1');
  assert.equal(company.plan_tier, 'basic');
  assert.equal(company.roster_enabled, true);
  assert.match(company.company_code, /^[A-Z0-9]{6,32}$/);

  const settings = db.tables.company_document_settings.filter((s) => s.company_id === r.companyId);
  assert.equal(settings.length, ALL_DOC_KEYS.length);
  assert.ok(settings.every((s) => s.is_active === false), 'every Platform document type is off');

  const roster = db.tables.roster.filter((x) => x.company_id === r.companyId);
  assert.equal(roster.length, 1);
  assert.equal(roster[0].is_owner, true);
  assert.equal(roster[0].role, 'supervisor');
  assert.equal(roster[0].name, 'Sam Lee');
  assert.notEqual(roster[0].email, 'sam@prairie.example', 'the Owner email is stored encrypted');

  assert.equal(db.tables.portal_scope_requests[0].company_id, r.companyId);
});

test('an unpaid scope is refused and nothing is written', async () => {
  const db = makeDb({ portal_scope_requests: [scope({ status: 'invoiced' })] });
  const r = await provisionPortalCompany(db, null, 's1');
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(db.tables.companies?.length || 0, 0);
});

test('a scope with no contact email is refused, since there would be no Owner', async () => {
  const db = makeDb({ portal_scope_requests: [scope({ contact_email: null })] });
  const r = await provisionPortalCompany(db, null, 's1');
  assert.equal(r.ok, false);
  assert.match(r.error, /contact email/);
  assert.equal(db.tables.companies?.length || 0, 0);
});

test('an unknown scope is a 404', async () => {
  const r = await provisionPortalCompany(makeDb({ portal_scope_requests: [] }), null, 'nope');
  assert.equal(r.status, 404);
});

test('running it twice reuses the company and makes no second Owner', async () => {
  const db = makeDb({ portal_scope_requests: [scope()] });
  const first = await provisionPortalCompany(db, null, 's1');
  const second = await provisionPortalCompany(db, null, 's1');
  assert.equal(second.ok, true);
  assert.equal(second.created, false);
  assert.equal(second.companyId, first.companyId);
  assert.equal(second.companyCode, first.companyCode);
  assert.equal(db.tables.companies.length, 1);
  assert.equal(db.tables.roster.length, 1);
});

test('a second run repairs a company whose Owner was never written', async () => {
  const db = makeDb({ portal_scope_requests: [scope()] });
  db.failOn('roster', 'insert');
  const first = await provisionPortalCompany(db, null, 's1');
  assert.equal(first.ok, true);
  assert.match(first.warnings.join(' '), /Account Owner could not be created/);
  db.clearFailures();
  const second = await provisionPortalCompany(db, null, 's1');
  assert.equal(second.warnings.length, 0);
  assert.equal(db.tables.roster.length, 1);
  assert.equal(db.tables.companies.find((c) => c.id === second.companyId).roster_enabled, true);
});

test('a failed document-settings write is reported, not hidden', async () => {
  const db = makeDb({ portal_scope_requests: [scope()] });
  db.failOn('company_document_settings', 'upsert');
  const r = await provisionPortalCompany(db, null, 's1');
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(' '), /document types/);
});

test('losing the claim race removes only the company this call created', async () => {
  // Another request links the scope between our read and our claim.
  const db = makeDb({ portal_scope_requests: [scope()], companies: [{ id: 99, name: 'Someone else', company_code: 'SOMEONE1' }] });
  const realFrom = db.from;
  let raced = false;
  db.from = (name) => {
    const q = realFrom(name);
    if (name === 'portal_scope_requests') {
      const realIs = q.is.bind(q);
      q.is = (col, val) => {
        if (!raced && col === 'company_id') { raced = true; db.tables.portal_scope_requests[0].company_id = 99; }
        return realIs(col, val);
      };
    }
    return q;
  };
  const r = await provisionPortalCompany(db, null, 's1');
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.deepEqual(db.tables.companies.map((c) => c.id), [99], 'the other company is untouched, ours is gone');
});

test('the Owner comes from the contact, as a supervisor', () => {
  const o = portalOwnerFor({ contact_name: 'Sam Lee', contact_email: 'sam@prairie.example' });
  assert.equal(o.isOwner, true);
  assert.equal(o.role, 'supervisor');
  assert.equal(portalOwnerFor({ contact_name: 'Sam Lee', contact_email: '' }), null);
});

// ---------------------------------------------------------------- monthly billing

function fakeStripe() {
  const calls = { products: [], subs: [] };
  return {
    calls,
    products: { create: async (body, opts) => { calls.products.push({ body, opts }); return { id: 'prod_1' }; } },
    subscriptions: {
      create: async (body, opts) => { calls.subs.push({ body, opts }); return { id: 'sub_1', status: 'trialing' }; },
      retrieve: async () => ({ id: 'sub_1', status: 'trialing' }),
    },
  };
}

test('the monthly fee becomes a CAD subscription billed by invoice, first one after the delay', async () => {
  const db = makeDb({ portal_scope_requests: [scope()] });
  const stripe = fakeStripe();
  const now = Date.UTC(2026, 9, 20);
  const r = await ensurePortalSubscription(stripe, db, scope(), now);
  assert.equal(r.started, true);
  const { body, opts } = stripe.calls.subs[0];
  assert.equal(body.customer, 'cus_1');
  assert.equal(body.collection_method, 'send_invoice');
  assert.equal(body.days_until_due, PORTAL_INVOICE_DAYS_UNTIL_DUE);
  assert.equal(body.trial_end, Math.floor((now + PORTAL_FIRST_INVOICE_DELAY_DAYS * 86400000) / 1000));
  assert.deepEqual(body.items[0].price_data, { currency: 'cad', product: 'prod_1', unit_amount: 4500, recurring: { interval: 'month' } });
  assert.equal(body.metadata.portal_scope_request_id, 's1');
  assert.equal(opts.idempotencyKey, 'portal-sub-s1');
  assert.equal(db.tables.portal_scope_requests[0].stripe_subscription_id, 'sub_1');
});

test('the subscription is stamped on the company when it already exists', async () => {
  const db = makeDb({ portal_scope_requests: [scope({ company_id: 5 })], companies: [{ id: 5, name: 'X' }] });
  await ensurePortalSubscription(fakeStripe(), db, scope({ company_id: 5 }));
  const co = db.tables.companies[0];
  assert.equal(co.stripe_subscription_id, 'sub_1');
  assert.equal(co.stripe_subscription_status, 'trialing');
});

test('no second subscription once one exists, and none without a monthly fee', async () => {
  const stripe = fakeStripe();
  const db = makeDb({ portal_scope_requests: [scope()] });
  assert.equal((await ensurePortalSubscription(stripe, db, scope({ stripe_subscription_id: 'sub_9' }))).started, false);
  assert.equal((await ensurePortalSubscription(stripe, db, scope({ monthly_fee_cents: null }))).started, false);
  assert.equal((await ensurePortalSubscription(stripe, db, scope({ monthly_fee_cents: 0 }))).started, false);
  assert.equal(stripe.calls.subs.length, 0);
});

test('a missing Stripe customer throws so the webhook retries', async () => {
  await assert.rejects(() => ensurePortalSubscription(fakeStripe(), makeDb({}), scope({ stripe_customer_id: null })), /no Stripe customer/);
});

test('a failed database write after Stripe succeeded throws, so Stripe retries the event', async () => {
  const db = makeDb({ portal_scope_requests: [scope()] });
  db.failOn('portal_scope_requests', 'update');
  await assert.rejects(() => ensurePortalSubscription(fakeStripe(), db, scope()), /subscription update failed/);
});

// ---------------------------------------------------------------- wiring

test('the webhook marks paid once, then always tries the subscription', () => {
  const src = readFileSync(new URL('../../api/stripe-webhook.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('async function handlePortalScopePaid'), src.indexOf('async function syncSubscriptionToCompany'));
  assert.match(body, /if \(scope\.status !== 'paid'\)/);
  // The subscription call sits outside the "not yet paid" branch, so a retry reaches it.
  assert.ok(body.indexOf('ensurePortalSubscription') > body.lastIndexOf("scope.status !== 'paid'"));
  assert.match(src, /await handlePortalScopePaid\(event\.data\.object\)/);
});

test('the admin actions are admin-only and never email the client', () => {
  const src = readFileSync(new URL('../../api/admin.js', import.meta.url), 'utf8');
  assert.match(src, /session\.role !== 'admin'\) return res\.status\(403\)/);
  const start = src.indexOf("if (action === 'create_portal_company')");
  const body = src.slice(start, src.indexOf("if (action === 'update_company_codes')"));
  assert.ok(!/sendEmail|issueAndEmailPinLink/.test(body));
});
