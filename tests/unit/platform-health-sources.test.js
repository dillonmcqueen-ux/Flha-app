// Pins the health card's two hand-kept lists to their sources (map break #43).
// CRONS in server-lib/platformHealth.js must match the crons in vercel.json,
// and MODEL_PRICES must cover every model the code sends to Anthropic.
// Without this a fourth cron never shows up on the dashboard and a model
// rename quietly turns cost into "unpriced".
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CRONS, MODEL_PRICES } from '../../server-lib/platformHealth.js';

const root = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const vercelCrons = JSON.parse(read('vercel.json')).crons || [];
const cronFiles = vercelCrons.map((c) => c.path.replace(/^\/api\//, '') + '.js');

test('every cron in vercel.json records a cron_run subtype that CRONS lists', () => {
  const found = new Set();
  for (const f of cronFiles) {
    const src = stripComments(read(join('api', f)));
    const subs = [...src.matchAll(/eventType:\s*['"]cron_run['"][^}]*?subtype:\s*['"]([a-z_]+)['"]/g)].map((m) => m[1]);
    assert.ok(subs.length > 0, `api/${f} is in vercel.json but records no cron_run event, so the health card cannot see it`);
    subs.forEach((s) => found.add(s));
  }
  const listed = new Set(CRONS.map((c) => c.subtype));
  for (const s of found) assert.ok(listed.has(s), `cron subtype "${s}" runs in vercel.json but is missing from CRONS`);
  for (const s of listed) assert.ok(found.has(s), `CRONS lists "${s}" but no cron in vercel.json records it`);
  assert.equal(vercelCrons.length, CRONS.length);
});

test('every cron file that records cron_run is scheduled in vercel.json', () => {
  const scheduled = new Set(cronFiles);
  for (const f of readdirSync(join(root, 'api')).filter((n) => n.startsWith('cron-'))) {
    if (/cron_run/.test(stripComments(read(join('api', f))))) {
      assert.ok(scheduled.has(f), `api/${f} records cron_run but is not in vercel.json crons`);
    }
  }
});

test('CRONS cadence roughly matches the vercel.json schedule', () => {
  for (const c of vercelCrons) {
    const [, , dom, , dow] = c.schedule.split(' ');
    const expected = dow !== '*' ? 168 : dom !== '*' ? 720 : 24;
    const sub = CRONS.find((x) => c.path.endsWith(x.subtype.replace(/_/g, '-')));
    assert.ok(sub, `no CRONS entry for ${c.path}`);
    assert.equal(sub.cadenceHours, expected, `${c.path} runs "${c.schedule}" but CRONS says ${sub.cadenceHours}h`);
  }
});

test('MODEL_PRICES covers every claude-* model the code uses', () => {
  const used = new Set();
  const dirs = ['api', 'server-lib'];
  for (const d of dirs) {
    for (const f of readdirSync(join(root, d)).filter((n) => n.endsWith('.js') && n !== 'platformHealth.js')) {
      const src = stripComments(read(join(d, f)));
      for (const m of src.matchAll(/['"`](claude-[a-z0-9.-]+)['"`]/g)) used.add(m[1]);
    }
  }
  assert.ok(used.size >= 3, 'model scan found almost nothing, the pattern has drifted');
  for (const m of used) assert.ok(MODEL_PRICES[m], `model "${m}" is used in code but has no MODEL_PRICES entry`);
  for (const m of Object.keys(MODEL_PRICES)) assert.ok(used.has(m), `MODEL_PRICES prices "${m}" but no code uses it`);
});
