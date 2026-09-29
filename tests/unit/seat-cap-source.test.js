// Pins the seat cap to ONE source (map break #42). The cap that blocks a
// company from adding people (api/companydata.js), the cap the founder
// dashboard's Seats card reports (server-lib/platformBusiness.js) and the
// number the Admin Panel shows beside a company all come from
// server-lib/onboardingHelpers.js. Two copies of "10 and 50" agree today and
// nothing stops one being edited without the other.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PLAN_SEAT_CAPS, planSeatCap, effectiveSeatCap } from '../../server-lib/onboardingHelpers.js';
import { buildBusinessMetrics } from '../../server-lib/platformBusiness.js';

test('effectiveSeatCap is the tier cap, and an unknown or missing tier is basic, never unlimited', () => {
  assert.equal(effectiveSeatCap('basic'), PLAN_SEAT_CAPS.basic);
  assert.equal(effectiveSeatCap('advanced'), PLAN_SEAT_CAPS.advanced);
  assert.equal(effectiveSeatCap('nonsense'), PLAN_SEAT_CAPS.basic);
  assert.equal(effectiveSeatCap(null), PLAN_SEAT_CAPS.basic);
  assert.equal(effectiveSeatCap(undefined), PLAN_SEAT_CAPS.basic);
  assert.equal(planSeatCap('nonsense'), null); // the "is this a real tier" question is unchanged
});

test('no server file defines its own seat cap table', () => {
  const offenders = [];
  for (const dir of ['api', 'server-lib']) {
    for (const f of readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'onboardingHelpers.js')) {
      const src = readFileSync(`${dir}/${f}`, 'utf8');
      if (/SEAT_CAP_BY_TIER\s*=|PLAN_SEAT_CAPS\s*=|basic:\s*10\s*,\s*advanced:\s*50/.test(src)) offenders.push(`${dir}/${f}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the enforcing handler and the dashboard both read effectiveSeatCap', () => {
  const companydata = readFileSync('api/companydata.js', 'utf8');
  const business = readFileSync('server-lib/platformBusiness.js', 'utf8');
  assert.match(companydata, /import \{[^}]*effectiveSeatCap[^}]*\} from '..\/server-lib\/onboardingHelpers.js'/);
  assert.equal((companydata.match(/effectiveSeatCap\(tier\)/g) || []).length, 4, 'all four enforcement sites');
  assert.match(business, /effectiveSeatCap\(c\.plan_tier\)/);
});

test('the dashboard reports the same cap the app enforces, including for an unknown tier', () => {
  const NOW = new Date('2026-09-29T12:00:00Z');
  const run = (tier) => buildBusinessMetrics({
    companies: [{ id: 1, name: 'A', created_at: '2026-01-01T00:00:00Z', plan_tier: tier, suspended: false }],
    roster: [{ company_id: 1, active: true, last_login_at: null }],
  }, {}, NOW).perCompany[0].seatCap;
  for (const tier of ['basic', 'advanced', 'nonsense', null]) assert.equal(run(tier), effectiveSeatCap(tier), String(tier));
});

test('the Admin Panel display copy matches the server table', () => {
  const panel = readFileSync('src/AdminPanel.jsx', 'utf8');
  const m = panel.match(/const SEAT_CAP_BY_TIER = \{\s*basic:\s*(\d+),\s*advanced:\s*(\d+)\s*\}/);
  assert.ok(m, 'src/AdminPanel.jsx should still declare its display copy (it cannot import server code)');
  assert.deepEqual({ basic: Number(m[1]), advanced: Number(m[2]) }, PLAN_SEAT_CAPS);
});
