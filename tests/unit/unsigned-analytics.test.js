// A record its author has not signed yet is not counted as a submitted document
// in the Analytics numbers (src/analyticsUtils.js): rates, site activity and the
// reporter leaderboard leave it out.

import test from 'node:test';
import assert from 'node:assert/strict';
import { highRiskFlhaRate, fieldSiteActivity, reporterLeaderboard } from '../../src/analyticsUtils.js';

const high = { hazards: [{ risk: 'High' }] };
const signed = { id: 1, worker_name: 'Cam', job_site: 'Pit', site_id: 5, hazards_json: high };
const unsigned = { id: 2, worker_name: 'Cam', job_site: 'Pit', site_id: 5, hazards_json: high, awaiting_signature: true };
const closed = { id: 3, worker_name: 'Cam', job_site: 'Pit', site_id: 5, hazards_json: high, awaiting_signature: true, unsigned_closed_at: '2026-10-01T00:00:00Z' };

test('the high risk rate counts only signed FLHAs', () => {
  const out = highRiskFlhaRate([signed, unsigned, closed]);
  assert.equal(out.total, 1);
  assert.equal(out.highRisk, 1);
});

test('site activity leaves unsigned FLHAs, near misses and incidents out', () => {
  const rows = fieldSiteActivity([signed, unsigned], [], [], [{ site: 'Pit', site_id: 5, awaiting_signature: true }], [{ site: 'Pit', site_id: 5 }]);
  const pit = rows.find((r) => r.siteId === 5);
  assert.equal(pit.flhas, 1);
  assert.equal(pit.nearMisses ?? 0, 0);
  assert.equal(pit.incidents, 1);
});

test('the leaderboard does not reward an unsigned FLHA', () => {
  const board = reporterLeaderboard([signed, unsigned, closed], [{ worker_name: 'Cam', awaiting_signature: true }], []);
  assert.deepEqual(board, [{ label: 'Cam', count: 1 }]);
});
