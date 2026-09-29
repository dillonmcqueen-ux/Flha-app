// Tests for server-lib/platformEvents.js: best-effort telemetry writer for
// the founder dashboard (see docs/schema/platform-events-migration.sql).
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { recordPlatformEvent, sanitizeMetrics, ALLOWED_METRIC_KEYS, anthropicUsageMetrics } from '../../server-lib/platformEvents.js';

function fakeSupabase({ throwOnInsert = false, returnError = false } = {}) {
  let inserted = null;
  const client = {
    from(table) {
      assert.equal(table, 'platform_events');
      return {
        insert(row) {
          if (throwOnInsert) return Promise.reject(new Error('boom'));
          inserted = row;
          return Promise.resolve({ data: null, error: returnError ? { message: 'nope' } : null });
        },
      };
    },
  };
  return { client, getInserted: () => inserted };
}

test('writes the given fields and coerces a string company id', async () => {
  const { client, getInserted } = fakeSupabase();
  await recordPlatformEvent(client, { eventType: 'ai_generation', status: 'ok', subtype: 'flha', companyId: '12', metrics: { input_tokens: 10 } });
  const row = getInserted();
  assert.equal(row.event_type, 'ai_generation');
  assert.equal(row.status, 'ok');
  assert.equal(row.subtype, 'flha');
  assert.equal(row.company_id, 12);
  assert.deepEqual(row.metrics, { input_tokens: 10 });
});

test('a missing company id is null, not 0', async () => {
  const { client, getInserted } = fakeSupabase();
  await recordPlatformEvent(client, { eventType: 'cron_run', status: 'ok', subtype: 'portal_reports' });
  assert.equal(getInserted().company_id, null);
  await recordPlatformEvent(client, { eventType: 'cron_run', status: 'ok', companyId: null });
  assert.equal(getInserted().company_id, null);
});

test('an unknown event type or status is dropped, not written', async () => {
  const { client, getInserted } = fakeSupabase();
  await recordPlatformEvent(client, { eventType: 'made_up', status: 'ok' });
  assert.equal(getInserted(), null);
  await recordPlatformEvent(client, { eventType: 'cron_run', status: 'weird' });
  assert.equal(getInserted(), null);
});

test('never throws, on a thrown insert or a returned error', async () => {
  await assert.doesNotReject(() => recordPlatformEvent(fakeSupabase({ throwOnInsert: true }).client, { eventType: 'cron_run', status: 'ok' }));
  await assert.doesNotReject(() => recordPlatformEvent(fakeSupabase({ returnError: true }).client, { eventType: 'cron_run', status: 'ok' }));
});

test('metrics keep numbers, booleans and short strings, and drop content-shaped values', () => {
  const out = sanitizeMetrics({
    duration_ms: 5, has_attachment: true, model: 'x'.repeat(200), nested: { a: 1 }, list: [1, 2], nan: NaN, nothing: null, subject: 'Invoice for Bob',
  });
  assert.equal(out.duration_ms, 5);
  assert.equal(out.has_attachment, true);
  assert.equal('subject' in out, false);
  assert.equal(out.model.length, 80);
  assert.equal('nested' in out, false);
  assert.equal('list' in out, false);
  assert.equal('nan' in out, false);
  assert.equal('nothing' in out, false);
  assert.equal(sanitizeMetrics(null), null);
  assert.equal(sanitizeMetrics({ a: {} }), null);
});

test('metrics cap the number of keys', () => {
  const big = {};
  for (const k of ALLOWED_METRIC_KEYS) big[k] = 1;
  assert.ok(Object.keys(sanitizeMetrics(big)).length <= 16);
});

test('anthropicUsageMetrics reads tokens and never copies content', () => {
  const m = anthropicUsageMetrics({
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 7 },
    stop_reason: 'end_turn',
    content: [{ text: 'SECRET DOCUMENT TEXT' }],
  }, { model: 'claude-sonnet-5', startedAt: Date.now() - 5 });
  assert.equal(m.input_tokens, 100);
  assert.equal(m.output_tokens, 50);
  assert.equal(m.cache_read_tokens, 7);
  assert.equal(m.stop_reason, 'end_turn');
  assert.ok(m.latency_ms >= 0);
  assert.equal(JSON.stringify(m).includes('SECRET'), false);
  assert.equal(anthropicUsageMetrics(null).input_tokens, null);
});

test('every writer in the repo passes a known event type', () => {
  const files = [
    ...readdirSync('api').filter((f) => f.endsWith('.js')).map((f) => 'api/' + f),
    ...readdirSync('server-lib').filter((f) => f.endsWith('.js')).map((f) => 'server-lib/' + f),
  ];
  const seen = new Set();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/eventType:\s*'([a-z_]+)'/g)) seen.add(m[1]);
  }
  assert.ok(seen.size >= 3, 'expected cron_run, email_send and ai_generation writers');
  for (const t of seen) assert.ok(['cron_run', 'email_send', 'ai_generation'].includes(t), 'unknown event type ' + t);
});

test('a hung insert times out instead of stalling the caller', async () => {
  const client = { from: () => ({ insert: () => new Promise(() => {}) }) };
  const t0 = Date.now();
  await recordPlatformEvent(client, { eventType: 'cron_run', status: 'ok' });
  assert.ok(Date.now() - t0 < 4000);
});
