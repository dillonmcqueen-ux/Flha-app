// Tests for the platform-health half of the founder dashboard
// (server-lib/platformHealth.js): scheduled job state, email delivery, AI
// success rate and cost. Cost is checked against the published price table
// in the module, and a model with no price is never guessed at.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildPlatformHealth, costOf, MODEL_PRICES, CRONS, CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER } from '../../server-lib/platformHealth.js';
import { buildPlatformOverview } from '../../server-lib/platformOverview.js';

const NOW = new Date('2026-09-29T12:00:00Z');
const ago = (hours) => new Date(NOW.getTime() - hours * 3600000).toISOString();
const ev = (o) => ({ event_type: 'ai_generation', status: 'ok', subtype: 'flha', company_id: 1, metrics: null, created_at: ago(1), ...o });

test('cost is tokens times the listed price, with cache reads and writes as multiples of input', () => {
  const p = MODEL_PRICES['claude-sonnet-5'];
  assert.equal(costOf({ model: 'claude-sonnet-5', input_tokens: 1e6, output_tokens: 1e6 }), p.input + p.output);
  const withCache = costOf({ model: 'claude-sonnet-5', input_tokens: 0, output_tokens: 0, cache_read_tokens: 1e6, cache_write_tokens: 1e6 });
  assert.equal(withCache, p.input * CACHE_READ_MULTIPLIER + p.input * CACHE_WRITE_MULTIPLIER);
});

test('a model with no price is unpriced, not zero and not guessed', () => {
  assert.equal(costOf({ model: 'claude-made-up', input_tokens: 1000, output_tokens: 1000 }), null);
  assert.equal(costOf({}), null);
  const h = buildPlatformHealth({ events: [ev({ metrics: { model: 'claude-made-up', input_tokens: 1000, output_tokens: 500 } })] }, NOW);
  assert.equal(h.ai.unpricedCalls, 1);
  assert.equal(h.ai.estimatedCost, 0);
});

test('AI success rate excludes rate limits, and failures are split by kind', () => {
  const h = buildPlatformHealth({ events: [
    ev({}), ev({}), ev({ status: 'error' }), ev({ status: 'refused' }), ev({ status: 'truncated' }), ev({ status: 'rate_limited' }),
  ] }, NOW);
  assert.equal(h.ai.calls, 6);
  assert.equal(h.ai.rateLimited, 1);
  assert.equal(h.ai.successRatePct, 40); // 2 ok of 5 attempts
  const s = h.ai.bySubtype[0];
  assert.deepEqual([s.ok, s.failed, s.refused, s.truncated, s.rateLimited], [2, 1, 1, 1, 1]);
});

test('AI cost rolls up by document type, model and company, with the company name', () => {
  const m = { model: 'claude-opus-5', input_tokens: 1e6, output_tokens: 0 };
  const h = buildPlatformHealth({ companies: [{ id: 1, name: 'Alpha' }], events: [ev({ metrics: m }), ev({ subtype: 'incident', metrics: m })] }, NOW);
  assert.equal(h.ai.estimatedCost, MODEL_PRICES['claude-opus-5'].input * 2);
  assert.equal(h.ai.byModel[0].model, 'claude-opus-5');
  assert.equal(h.ai.topCompanies[0].name, 'Alpha');
  assert.equal(h.ai.topCompanies[0].calls, 2);
  assert.equal(h.ai.bySubtype.length, 2);
});

test('a scheduled job is ok, failed or overdue from its last run, and not-yet-observed before telemetry has had time', () => {
  const daily = CRONS.find(c => c.subtype === 'company_brain_summary');
  const okRun = { event_type: 'cron_run', subtype: 'company_brain_summary', status: 'ok', metrics: { duration_ms: 900 }, created_at: ago(3) };
  const h1 = buildPlatformHealth({ events: [okRun] }, NOW);
  assert.equal(h1.crons.find(c => c.subtype === daily.subtype).state, 'ok');
  assert.equal(h1.crons.find(c => c.subtype === daily.subtype).lastDurationMs, 900);

  const failed = { ...okRun, status: 'error' };
  assert.equal(buildPlatformHealth({ events: [failed] }, NOW).crons.find(c => c.subtype === daily.subtype).state, 'failed');

  const stale = { ...okRun, created_at: ago(24 * 1.5 + 3) };
  assert.equal(buildPlatformHealth({ events: [stale] }, NOW).crons.find(c => c.subtype === daily.subtype).state, 'overdue');

  // telemetry only just started: a job with no run yet is not overdue
  const fresh = buildPlatformHealth({ events: [ev({ created_at: ago(2) })] }, NOW);
  assert.equal(fresh.crons.every(c => c.state === 'not_observed_yet'), true);

  // telemetry has been on for two weeks and a weekly job never ran
  const old = buildPlatformHealth({ events: [ev({ created_at: ago(24 * 14) })] }, NOW);
  assert.equal(old.crons.find(c => c.subtype === 'equipment_reports').state, 'overdue');
});

test('email counts sends, failures and skips, with failure kinds and no addresses', () => {
  const e = (status, subtype, extra) => ({ event_type: 'email_send', status, subtype: subtype || null, company_id: null, metrics: { latency_ms: 100, ...extra }, created_at: ago(2) });
  const h = buildPlatformHealth({ events: [e('ok'), e('ok'), e('ok'), e('error', 'http_422', { http_status: 422 }), e('skipped', 'no_api_key')] }, NOW);
  assert.deepEqual([h.email.sent, h.email.failed, h.email.skipped], [3, 1, 1]);
  assert.equal(h.email.failureRatePct, 25);
  assert.deepEqual(h.email.failureKinds, [{ kind: 'http_422', count: 1 }]);
  assert.equal(JSON.stringify(h).includes('@'), false);
});

test('events older than 30 days are ignored, and an empty table is reported as empty', () => {
  const h = buildPlatformHealth({ events: [ev({ created_at: ago(24 * 45) })] }, NOW);
  assert.equal(h.ai.calls, 0);
  assert.equal(buildPlatformHealth({ events: [] }, NOW).empty, true);
});

test('recent trouble lists non-ok events newest first, without content', () => {
  const h = buildPlatformHealth({ events: [
    ev({ status: 'error', created_at: ago(5), metrics: { http_status: 529 } }),
    ev({ status: 'refused', created_at: ago(1) }),
    ev({ status: 'ok' }),
  ] }, NOW);
  assert.equal(h.recentFailures.length, 2);
  assert.equal(h.recentFailures[0].status, 'refused');
  assert.equal(h.recentFailures[1].httpStatus, 529);
  assert.deepEqual(Object.keys(h.recentFailures[0]).sort(), ['at', 'httpStatus', 'status', 'subtype', 'type']);
});

test('the overview reports unavailable when the table could not be read, and health when it could', () => {
  assert.deepEqual(buildPlatformOverview({ events: null }, NOW).platformHealth, { unavailable: true });
  assert.equal(buildPlatformOverview({ events: [] }, NOW).platformHealth.empty, true);
});

test('only platformOverview.js imports platformHealth.js', () => {
  const importers = [];
  for (const dir of ['api', 'server-lib']) {
    for (const f of readdirSync(dir).filter(x => x.endsWith('.js') && x !== 'platformHealth.js')) {
      if (readFileSync(`${dir}/${f}`, 'utf8').includes('platformHealth.js')) importers.push(`${dir}/${f}`);
    }
  }
  assert.deepEqual(importers, ['server-lib/platformOverview.js']);
});
