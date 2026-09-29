// Tests for the founder dashboard's numbers (server-lib/platformOverview.js)
// and for who can reach them (api/admin.js).
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1/';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SESSION_SECRET ||= 'test-session-secret';

const { buildPlatformOverview, DOC_TYPES, UNMEASURED_DOC_KEYS } = await import('../../server-lib/platformOverview.js');
const { ALL_DOC_KEYS, MODULES, MODULE_KEYS } = await import('../../server-lib/pricing.js');
const adminHandler = (await import('../../api/admin.js')).default;

const NOW = new Date('2026-09-29T12:00:00Z');
const ago = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

const fixture = () => ({
  companies: [
    { id: 1, name: 'Alpha', created_at: ago(20), plan_tier: 'basic', suspended: false, stripe_subscription_status: 'active' },
    { id: 2, name: 'Beta', created_at: ago(90), plan_tier: 'advanced', suspended: false, stripe_subscription_status: null },
    { id: 3, name: 'Gone', created_at: ago(200), plan_tier: 'basic', suspended: true, stripe_subscription_status: 'canceled' },
  ],
  docs: {
    flha: [{ company_id: 1, created_at: ago(1) }, { company_id: 1, created_at: ago(2) }, { company_id: 2, created_at: ago(60) }],
    daily: [{ company_id: 1, created_at: ago(10) }],
    custom: [{ company_id: null, created_at: ago(1) }],
  },
  roster: [
    { company_id: 1, active: true, last_login_at: ago(2) },
    { company_id: 1, active: true, last_login_at: ago(20) },
    { company_id: 2, active: true, last_login_at: null },
    { company_id: 2, active: false, last_login_at: ago(1) },
  ],
  docSettings: [
    { company_id: 1, document_key: 'flha', is_active: true },
    { company_id: 1, document_key: 'daily', is_active: true },
    { company_id: 1, document_key: 'timeclock', is_active: false },
    { company_id: 2, document_key: 'flha', is_active: true },
    { company_id: 3, document_key: 'flha', is_active: true },
  ],
  onboarding: [{ status: 'new', created_at: ago(3) }, { status: 'done', created_at: ago(40) }],
});

test('documents are counted per type and per day over the last 30 days', () => {
  const o = buildPlatformOverview(fixture(), NOW);
  const flha = o.documents.byType.find(t => t.type === 'flha');
  assert.deepEqual([flha.last7, flha.last30, flha.total], [2, 2, 3]);
  assert.equal(o.documents.perDay.length, 30);
  assert.equal(o.documents.perDay.reduce((n, d) => n + d.total, 0), 4); // 2 flha + 1 daily + 1 custom, the 60 day old flha is out
});

test('active companies and workers use the 7 and 30 day windows', () => {
  const o = buildPlatformOverview(fixture(), NOW);
  assert.equal(o.totals.activeCompanies7, 1);
  assert.equal(o.totals.activeCompanies30, 1);
  assert.equal(o.totals.activeWorkers7, 1);
  assert.equal(o.totals.activeWorkers30, 2);
  assert.equal(o.totals.rosterActive, 3);
});

test('suspended companies are excluded from live counts and adoption', () => {
  const o = buildPlatformOverview(fixture(), NOW);
  assert.equal(o.totals.live, 2);
  assert.equal(o.totals.suspended, 1);
  const safety = o.modules.find(m => m.key === 'safety');
  assert.equal(safety.bought, 2); // Alpha and Beta, not the suspended one
  assert.equal(safety.used, 1);   // only Alpha filed in 30 days
  assert.equal(safety.adoptionPct, 50);
});

test('a module with no filing of its own is reported as not measurable, not zero', () => {
  const o = buildPlatformOverview(fixture(), NOW);
  const maintenance = o.modules.find(m => m.key === 'maintenance');
  assert.equal(maintenance.used, null);
  assert.equal(maintenance.adoptionPct, null);
});

test('plans and subscription status are tallied, sign-ups and funnel counted', () => {
  const o = buildPlatformOverview(fixture(), NOW);
  assert.deepEqual(o.plans.byTier, { basic: 1, advanced: 1 });
  assert.equal(o.plans.bySubscription.active, 1);
  assert.equal(o.plans.bySubscription.none, 1);
  assert.deepEqual(o.signups.funnel, { new: 1, done: 1 });
  assert.equal(o.signups.months.reduce((n, m) => n + m.signups, 0), 2); // 200 days ago is outside 6 months
});

test('per company rows carry counts and recency, nothing else', () => {
  const o = buildPlatformOverview(fixture(), NOW);
  const alpha = o.perCompany.find(c => c.name === 'Alpha');
  assert.equal(alpha.docs30, 3);
  assert.equal(alpha.daysSinceLastDoc, 1);
  assert.deepEqual(Object.keys(alpha).sort(), ['daysSinceLastDoc', 'docs30', 'id', 'lastDocAt', 'name', 'subscription', 'tier']);
  assert.equal(o.perCompany.some(c => c.name === 'Gone'), false);
});

test('an empty platform returns zeros rather than throwing', () => {
  const o = buildPlatformOverview({}, NOW);
  assert.equal(o.totals.companies, 0);
  assert.equal(o.documents.perDay.length, 30);
  assert.deepEqual(o.perCompany, []);
});

// ── who can reach it ────────────────────────────────────────────────────

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function call(body) {
  return new Promise((resolve) => {
    const res = { status(code) { this.code = code; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    adminHandler({ method: 'POST', body }, res);
  });
}

test('a supervisor, a worker and a missing token all get 403 on platform_overview', async () => {
  for (const role of ['supervisor', 'worker']) {
    const r = await call({ action: 'platform_overview', token: sign({ role, companyId: 1, issuedAt: Date.now() }) });
    assert.equal(r.code, 403, role);
  }
  assert.equal((await call({ action: 'platform_overview' })).code, 403);
  assert.equal((await call({ action: 'platform_overview', token: 'garbage.token' })).code, 403);
});

test('a login ticket cannot reach it either', async () => {
  const r = await call({ action: 'platform_overview', token: sign({ role: 'admin', purpose: 'master', issuedAt: Date.now() }) });
  assert.equal(r.code, 403);
});

test('only api/admin.js imports the overview loader', () => {
  const importers = [];
  for (const dir of ['api', 'server-lib']) {
    for (const f of readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'platformOverview.js' && x !== 'platformBusiness.js')) {
      if (readFileSync(`${dir}/${f}`, 'utf8').includes('platformOverview.js')) importers.push(`${dir}/${f}`);
    }
  }
  assert.deepEqual(importers, ['api/admin.js']);
});

// ── break #41: the dashboard's list must track pricing.js ───────────────

test('every module doc key is either measured or explicitly listed as unmeasured', () => {
  const measured = DOC_TYPES.map(t => t.docKey).filter(Boolean);
  const covered = new Set([...measured, ...UNMEASURED_DOC_KEYS]);
  const missing = ALL_DOC_KEYS.filter(k => !covered.has(k));
  assert.deepEqual(missing, [], `pricing.js has doc keys the dashboard neither measures nor lists as unmeasured: ${missing.join(', ')}. Add them to DOC_TYPES or UNMEASURED_DOC_KEYS in server-lib/platformOverview.js.`);
});

test('the dashboard does not name a doc key that no module sells', () => {
  const known = new Set(ALL_DOC_KEYS);
  const stray = [...DOC_TYPES.map(t => t.docKey).filter(Boolean), ...UNMEASURED_DOC_KEYS].filter(k => !known.has(k));
  assert.deepEqual(stray, [], `platformOverview.js names doc keys pricing.js does not know: ${stray.join(', ')}`);
});

test('a key is never both measured and listed as unmeasured', () => {
  const measured = new Set(DOC_TYPES.map(t => t.docKey).filter(Boolean));
  assert.deepEqual(UNMEASURED_DOC_KEYS.filter(k => measured.has(k)), []);
});

test('every module reports either a measurable key or only unmeasured ones, never neither', () => {
  const measured = new Set(DOC_TYPES.map(t => t.docKey).filter(Boolean));
  for (const key of MODULE_KEYS) {
    for (const dk of MODULES[key].docKeys) {
      assert.ok(measured.has(dk) || UNMEASURED_DOC_KEYS.includes(dk), `${key}: ${dk} is uncovered`);
    }
  }
});
