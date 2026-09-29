// Tests for the business half of the founder dashboard
// (server-lib/platformBusiness.js): MRR estimate, seats, health, time to
// first document. Everything is checked against pricing.js so a price change
// cannot leave these numbers quietly wrong.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { buildBusinessMetrics, boughtModuleKeys, estimateMonthly, bandFor, NEW_COMPANY_DAYS } from '../../server-lib/platformBusiness.js';
import { BASE, MODULES } from '../../server-lib/pricing.js';

const NOW = new Date('2026-09-29T12:00:00Z');
const ago = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const typeByDocKey = { flha: 'flha', toolbox: 'toolbox', incident: 'incident', nearmiss: 'nearmiss', daily: 'daily' };

const co = (o) => ({ id: 1, name: 'Alpha', created_at: ago(100), plan_tier: 'basic', suspended: false, stripe_subscription_status: 'active', ...o });
const on = (companyId, ...keys) => keys.map((document_key) => ({ company_id: companyId, document_key, is_active: true }));

test('estimateMonthly is the platform base plus each module at that tier, from pricing.js', () => {
  assert.equal(estimateMonthly('basic', []), BASE.basic);
  assert.equal(estimateMonthly('advanced', ['safety', 'daily']), BASE.advanced + MODULES.safety.price.advanced + MODULES.daily.price.advanced);
  assert.equal(estimateMonthly('nonsense', ['safety']), null);
  assert.equal(estimateMonthly(null, []), null);
});

test('a module counts as bought when any of its doc keys is switched on', () => {
  assert.deepEqual(boughtModuleKeys(new Set(['flha'])), ['safety']);
  assert.deepEqual(boughtModuleKeys(new Set(['flha', 'toolbox', 'daily'])), ['safety', 'daily']);
  assert.deepEqual(boughtModuleKeys(undefined), []);
});

test('MRR splits into billed, not billed and at risk, and excludes suspended companies', () => {
  const b = buildBusinessMetrics({
    companies: [
      co({ id: 1 }),                                                  // billed
      co({ id: 2, stripe_subscription_status: null }),                // not billed via Stripe
      co({ id: 3, stripe_subscription_status: 'past_due' }),          // at risk
      co({ id: 4, suspended: true }),                                 // excluded
    ],
    docSettings: [...on(1, 'flha'), ...on(2, 'flha'), ...on(3, 'flha'), ...on(4, 'flha')],
  }, { typeByDocKey }, NOW);
  const each = BASE.basic + MODULES.safety.price.basic;
  assert.equal(b.mrr.estimated, each * 3);
  assert.equal(b.mrr.billed, each);
  assert.equal(b.mrr.notBilled, each);
  assert.equal(b.mrr.atRisk, each);
  assert.equal(b.perCompany.length, 3);
});

test('a live company with no plan tier is counted as unpriced, not as zero revenue', () => {
  const b = buildBusinessMetrics({ companies: [co({ plan_tier: null })], docSettings: on(1, 'flha') }, { typeByDocKey }, NOW);
  assert.equal(b.mrr.unpriced, 1);
  assert.equal(b.mrr.estimated, 0);
  assert.equal(b.perCompany[0].monthly, null);
});

test('seat usage is active roster over the tier cap, flagged at 80 percent', () => {
  const roster = [];
  for (let i = 0; i < 8; i++) roster.push({ company_id: 1, active: true, last_login_at: ago(1) });
  roster.push({ company_id: 1, active: false, last_login_at: ago(1) }); // inactive never counts
  const b = buildBusinessMetrics({ companies: [co()], roster, docSettings: on(1, 'flha') }, { typeByDocKey }, NOW);
  assert.equal(b.perCompany[0].seatsUsed, 8);
  assert.equal(b.perCompany[0].seatCap, 10);
  assert.equal(b.perCompany[0].seatPct, 80);
  assert.equal(b.seats.nearCap.length, 1);
  assert.deepEqual(Object.keys(b.seats.nearCap[0]).sort(), ['cap', 'id', 'name', 'pct', 'used']);
});

test('a healthy company scores high, and its score is the sum of the four parts', () => {
  const b = buildBusinessMetrics({
    companies: [co()],
    docs: { flha: [{ company_id: 1, created_at: ago(1) }] },
    roster: [{ company_id: 1, active: true, last_login_at: ago(1) }],
    docSettings: on(1, 'flha'),
  }, { typeByDocKey }, NOW);
  const c = b.perCompany[0];
  assert.equal(c.score, 40 + 30 + 20 + 10);
  assert.equal(c.band, 'healthy');
  assert.deepEqual(c.reasons, []);
});

test('a dormant company is at risk and says why', () => {
  const b = buildBusinessMetrics({
    companies: [co({ stripe_subscription_status: 'past_due' })],
    docs: { flha: [{ company_id: 1, created_at: ago(45) }] },
    roster: [{ company_id: 1, active: true, last_login_at: ago(40) }],
    docSettings: on(1, 'flha'),
  }, { typeByDocKey }, NOW);
  const c = b.perCompany[0];
  assert.equal(c.band, 'at_risk');
  assert.ok(c.reasons.some(r => r.includes('No document in 45 days')));
  assert.ok(c.reasons.some(r => r.includes('logged in this week')));
  assert.ok(c.reasons.some(r => r.includes('past_due')));
  assert.equal(b.health.atRisk, 1);
});

test('a company younger than the grace period is not scored', () => {
  const b = buildBusinessMetrics({ companies: [co({ created_at: ago(NEW_COMPANY_DAYS - 1) })], docSettings: on(1, 'flha') }, { typeByDocKey }, NOW);
  assert.equal(b.perCompany[0].score, null);
  assert.equal(b.perCompany[0].band, 'new');
  assert.equal(b.health.new, 1);
});

test('modules with no filing of their own are left out of the adoption part, not counted against', () => {
  // Maintenance depends on inspections and has no key in typeByDocKey here.
  const b = buildBusinessMetrics({
    companies: [co()],
    docs: { flha: [{ company_id: 1, created_at: ago(1) }] },
    roster: [{ company_id: 1, active: true, last_login_at: ago(1) }],
    docSettings: on(1, 'flha', 'maintenance'),
  }, { typeByDocKey }, NOW);
  assert.equal(b.perCompany[0].score, 100);
});

test('time to first document is the median across companies, and never-filed is counted', () => {
  const b = buildBusinessMetrics({
    companies: [
      co({ id: 1, created_at: ago(100) }),
      co({ id: 2, created_at: ago(100) }),
      co({ id: 3, created_at: ago(100) }),
      co({ id: 4, created_at: ago(100) }),
    ],
    docs: { flha: [
      { company_id: 1, created_at: ago(99) },   // 1 day
      { company_id: 2, created_at: ago(95) },   // 5 days
      { company_id: 3, created_at: ago(90) },   // 10 days
    ] },
  }, { typeByDocKey }, NOW);
  assert.equal(b.timeToFirstDocument.medianDays, 5);
  assert.equal(b.timeToFirstDocument.filed, 3);
  assert.equal(b.timeToFirstDocument.neverFiled, 1);
});

test('bands sit at 70 and 40', () => {
  assert.equal(bandFor(70), 'healthy');
  assert.equal(bandFor(69), 'watch');
  assert.equal(bandFor(40), 'watch');
  assert.equal(bandFor(39), 'at_risk');
});

test('an empty platform returns zeros rather than throwing', () => {
  const b = buildBusinessMetrics({}, {}, NOW);
  assert.equal(b.mrr.estimated, 0);
  assert.equal(b.timeToFirstDocument.medianDays, null);
  assert.deepEqual(b.perCompany, []);
});

test('the per company rows carry no worker or document content', () => {
  const b = buildBusinessMetrics({ companies: [co()], roster: [{ company_id: 1, active: true, last_login_at: ago(1), name: 'Sam', email: 'sam@x.ca' }], docSettings: on(1, 'flha') }, { typeByDocKey }, NOW);
  assert.equal(JSON.stringify(b).includes('Sam'), false);
  assert.equal(JSON.stringify(b).includes('sam@x.ca'), false);
});

test('only platformOverview.js imports platformBusiness.js', () => {
  const importers = [];
  for (const dir of ['api', 'server-lib']) {
    for (const f of readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'platformBusiness.js')) {
      if (readFileSync(`${dir}/${f}`, 'utf8').includes('platformBusiness.js')) importers.push(`${dir}/${f}`);
    }
  }
  assert.deepEqual(importers, ['server-lib/platformOverview.js']);
});
