// Break #21: module gating used to be presentation only.
//
// The Dashboard hid a tab, the worker menu hid a card, the weekly PDF
// skipped a section — and every handler behind them answered anyone who
// asked. A company that never bought Fuel & Consumables (or dropped it)
// still had full read/write access to it through a saved URL, a stale tab,
// or a client whose settings fetch failed, because src/Dashboard.jsx fails
// OPEN when that fetch fails.
//
// Two halves are pinned here:
//
//   1. server-lib/docKeyGate.js itself — deny-by-default, admin exempt, and
//      deny on a read error. The direction of the default is the whole
//      thing: allow-by-default is break #6, which was live on 2026-09-18
//      and handed two of three companies document types nobody had decided
//      to give them.
//   2. a REAL handler (api/fuellogs.js) behind a stand-in PostgREST, so
//      what is asserted is what the handler actually puts on the wire —
//      including that a denied submit writes nothing at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

// ── the gate on its own ──────────────────────────────────────────────────

const { isDocKeyActive, requireDocKey, moduleLabelForDocKey } = await import('../../server-lib/docKeyGate.js');

// Just enough of the supabase-js builder chain for one settings lookup.
function stubClient(response) {
  const calls = [];
  const builder = {
    select() { return builder; },
    eq(col, val) { calls.push([col, val]); return builder; },
    limit() { return Promise.resolve(response); },
  };
  return { calls, from(table) { calls.push(['from', table]); return builder; } };
}

test('a missing settings row denies — the default is OFF, not ON', async () => {
  const db = stubClient({ data: [], error: null });
  assert.equal(await isDocKeyActive(db, 7, 'fuellog'), false);
});

test('an explicit is_active: false denies', async () => {
  const db = stubClient({ data: [{ is_active: false }], error: null });
  assert.equal(await isDocKeyActive(db, 7, 'fuellog'), false);
});

test('an explicit is_active: true allows', async () => {
  const db = stubClient({ data: [{ is_active: true }], error: null });
  assert.equal(await isDocKeyActive(db, 7, 'fuellog'), true);
});

test('a failed lookup denies — a gate that opens when it breaks is not a gate', async () => {
  const db = stubClient({ data: null, error: { message: 'connection reset' } });
  assert.equal(await isDocKeyActive(db, 7, 'fuellog'), false);
});

test('the lookup is scoped to the company AND the key, never the key alone', async () => {
  const db = stubClient({ data: [{ is_active: true }], error: null });
  await isDocKeyActive(db, 7, 'fuellog');
  assert.deepEqual(db.calls, [['from', 'company_document_settings'], ['company_id', 7], ['document_key', 'fuellog']]);
});

test('no company id denies without even asking', async () => {
  const db = stubClient({ data: [{ is_active: true }], error: null });
  assert.equal(await isDocKeyActive(db, null, 'fuellog'), false);
  assert.deepEqual(db.calls, [], 'a session with no company must not fall through to a query');
});

test('requireDocKey denies a supervisor whose company has no row, with the module named', async () => {
  const db = stubClient({ data: [], error: null });
  const denied = await requireDocKey(db, { role: 'supervisor', companyId: 7 }, 'fuellog');
  assert.equal(denied.status, 403);
  assert.match(denied.error, /Fuel & Consumables/, 'the message must name the module, not the doc key');
});

test('requireDocKey lets a supervisor through when the row says active', async () => {
  const db = stubClient({ data: [{ is_active: true }], error: null });
  assert.equal(await requireDocKey(db, { role: 'supervisor', companyId: 7 }, 'fuellog'), null);
});

test('requireDocKey exempts admin — that is the founder, not a customer', async () => {
  // The Admin Panel reads across every company at once (api/flhas.js's
  // `count` is per-company totals for the onboarding console). Gating the
  // founder would break the console that decides what a company is sold.
  const db = stubClient({ data: [], error: null });
  assert.equal(await requireDocKey(db, { role: 'admin', companyId: null }, 'fuellog'), null);
  assert.deepEqual(db.calls, [], 'admin must not even cost a query');
});

test('a lookup that FAILS denies with 503, not 403 — or it deletes queued work', async () => {
  // This is the sharp edge of shipping the gate and the offline drop path
  // together. To a queued submission a 403 means "drop it, it can never
  // succeed" (isPermanentRejection in src/offlineQueue.js). A settings read
  // that blipped is not a company without the module, and answering it with
  // 403 would throw away a worker's shift over a five-second outage.
  const db = stubClient({ data: null, error: { message: 'connection reset' } });
  const denied = await requireDocKey(db, { role: 'supervisor', companyId: 7 }, 'fuellog');
  assert.equal(denied.status, 503, 'a transient failure must be retryable');
  assert.doesNotMatch(denied.error, /plan/, 'and must not tell a paying company it did not buy the module');
});

test('requireDocKey denies a worker the same way it denies a supervisor', async () => {
  const db = stubClient({ data: [{ is_active: false }], error: null });
  const denied = await requireDocKey(db, { role: 'worker', companyId: 7, userId: 3 }, 'fuellog');
  assert.equal(denied.status, 403);
});

test('every module label resolves from pricing.js rather than a copied list', async () => {
  const { MODULES, MODULE_KEYS } = await import('../../server-lib/pricing.js');
  for (const moduleKey of MODULE_KEYS) {
    for (const docKey of MODULES[moduleKey].docKeys) {
      assert.equal(moduleLabelForDocKey(docKey), MODULES[moduleKey].label, `${docKey} must name its own module`);
    }
  }
});

// ── the gate inside a real handler ───────────────────────────────────────

const SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

function mintToken(payload) {
  const data = Buffer.from(JSON.stringify({ issuedAt: Date.now(), ...payload })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

// Stand-in PostgREST. `settings` decides what company_document_settings
// answers; every other table answers with whatever `rows` holds for it (or
// an empty list), and every request is recorded so a test can assert that a
// denied call never reached the data at all.
function startFakeSupabase({ settings = [], rows = {} } = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const table = url.pathname.replace('/rest/v1/', '');
    const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
    calls.push({ method: req.method, table, body: body ? JSON.parse(body) : null, query: url.search });

    const send = (code, payload) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (table === 'company_document_settings') {
      const companyId = (url.searchParams.get('company_id') || '').replace('eq.', '');
      const docKey = (url.searchParams.get('document_key') || '').replace('eq.', '');
      const hit = settings.filter(s => String(s.company_id) === companyId && s.document_key === docKey);
      return send(200, hit.map(s => ({ is_active: s.is_active })));
    }
    if (req.method === 'POST') return send(201, rows[table] || []);
    return send(200, rows[table] || []);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      calls,
      close: () => new Promise(r => server.close(r)),
    }));
  });
}

function fakeRes() {
  const out = { statusCode: null, body: null };
  return {
    out,
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
  };
}

// The handler module reads SUPABASE_URL at import time, so the fake has to
// be listening before the import and the same instance serves every case.
const FUEL_LOG_ROW = {
  id: 91, company_id: 7, equipment_label: 'Unit 12 Peterbilt 579', equipment_id: 44,
  worker_name: 'R. Chen', hour_reading: 8421, reading_unit: 'Hours',
  quantity: 310, quantity_unit: 'L', cost: null, created_at: '2026-09-20T15:04:00.000Z',
};

const fake = await startFakeSupabase({
  settings: [
    // Company 7 bought Fuel & Consumables. Company 8 did not — and, like a
    // company provisioned through checkout, has the row written explicitly
    // off rather than merely absent. Company 9 has no row at all, which is
    // the case deny-by-default exists for.
    { company_id: 7, document_key: 'fuellog', is_active: true },
    { company_id: 8, document_key: 'fuellog', is_active: false },
    { company_id: 7, document_key: 'certifications', is_active: false },
  ],
  rows: { fuel_logs: [FUEL_LOG_ROW], inspections: [] },
});

process.env.SUPABASE_URL = fake.url;
const { default: fuelLogsHandler } = await import('../../api/fuellogs.js');

test.after(() => fake.close());

async function call(body) {
  const res = fakeRes();
  await fuelLogsHandler({ method: 'POST', body }, res);
  return res.out;
}

test('a supervisor at a company WITH the module still gets their fuel logs', async () => {
  const out = await call({ action: 'list', token: mintToken({ role: 'supervisor', companyId: 7 }) });
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.records.length, 1);
  assert.equal(out.body.records[0].equipment_label, 'Unit 12 Peterbilt 579');
});

test('a supervisor at a company with the module switched OFF gets a 403, not the data', async () => {
  const out = await call({ action: 'list', token: mintToken({ role: 'supervisor', companyId: 8 }) });
  assert.equal(out.statusCode, 403);
  assert.match(out.body.error, /Fuel & Consumables/);
  assert.equal(out.body.records, undefined, 'no rows may come back alongside the refusal');
});

test('a supervisor at a company with NO settings row at all gets a 403 (deny-by-default)', async () => {
  const out = await call({ action: 'list', token: mintToken({ role: 'supervisor', companyId: 9 }) });
  assert.equal(out.statusCode, 403);
});

test('a denied worker submit writes nothing — the gate runs before the insert', async () => {
  const before = fake.calls.length;
  const out = await call({
    action: 'submit',
    token: mintToken({ role: 'worker', companyId: 8 }),
    record: { equipment_label: 'Unit 12', worker_name: 'R. Chen', quantity: 300, quantity_unit: 'L' },
  });
  assert.equal(out.statusCode, 403);
  const after = fake.calls.slice(before);
  assert.deepEqual(
    after.filter(c => c.method === 'POST').map(c => c.table), [],
    'a refused submit must not insert a fuel log',
  );
  assert.deepEqual(
    [...new Set(after.map(c => c.table))], ['company_document_settings'],
    'the only table a refused submit touches is the settings it was refused by',
  );
});

test('a worker at a company WITH the module still submits', async () => {
  const out = await call({
    action: 'submit',
    token: mintToken({ role: 'worker', companyId: 7 }),
    record: { equipment_label: 'Unit 12 Peterbilt 579', worker_name: 'R. Chen', quantity: 310, quantity_unit: 'L' },
  });
  assert.notEqual(out.statusCode, 403, `expected the submit through, got ${JSON.stringify(out.body)}`);
});

test('an admin session is not gated, even for a company with the module off', async () => {
  const out = await call({ action: 'list', token: mintToken({ role: 'admin', companyId: null }) });
  assert.equal(out.statusCode, 200);
});

test('a company that bought fuel but not certifications is unaffected here', async () => {
  // The combination check: gating one module must not leak into another.
  // Company 7 has certifications explicitly OFF and fuellog ON.
  const out = await call({ action: 'list', token: mintToken({ role: 'supervisor', companyId: 7 }) });
  assert.equal(out.statusCode, 200);
});

// ── the gate meeting the offline queue ───────────────────────────────────
//
// The reason the drop path in src/offlineQueue.js had to land before these
// guards did. A worker fuels up with no signal, the entry queues, and by the
// time the phone reconnects the handler answers 403 — the same answer
// forever. The old drainQueue marked an attempt and `break`ed, so that one
// entry sat at the head of the fuel-log queue permanently and every later
// fuel-up queued behind it was never sent, with nothing shown anywhere.
//
// This drives the REAL handler through the REAL drainQueue, with the error
// shaped exactly the way src/FuelLog.jsx's resubmitFuelLog shapes it.

const { installFakeIndexedDB } = await import('./helpers/fakeIndexedDB.js');
installFakeIndexedDB();
const { enqueueSubmission, drainQueue, listQueued } = await import('../../src/offlineQueue.js');

// The four lines src/FuelLog.jsx (and the other ten resubmit functions) run
// on a non-2xx response, against the real handler instead of fetch.
function resubmitThroughHandler(token) {
  return async (payload, clientSubmissionId) => {
    const out = await call({ action: 'submit', token, clientSubmissionId, record: payload });
    if (out.statusCode >= 300) {
      const err = new Error(out.body.error || `Save failed (${out.statusCode})`);
      err.isServerError = true;
      err.status = out.statusCode;
      throw err;
    }
    return out.body;
  };
}

test("a worker's queued fuel-ups at a company without the module are dropped and reported, not wedged", async () => {
  await enqueueSubmission('fuellog', 'csid-a', { equipment_label: 'Unit 12', worker_name: 'R. Chen', quantity: 310, quantity_unit: 'L' });
  await enqueueSubmission('fuellog', 'csid-b', { equipment_label: 'Unit 12', worker_name: 'R. Chen', quantity: 280, quantity_unit: 'L' });

  const result = await drainQueue('fuellog', resubmitThroughHandler(mintToken({ role: 'worker', companyId: 8 })));

  assert.equal(result.succeeded, 0);
  assert.equal(result.remaining, 0, 'the second entry must not be left stuck behind the first');
  assert.equal(result.dropped.length, 2, 'both are reported — this is real lost work, not a silent purge');
  assert.match(result.dropped[0].reason, /Fuel & Consumables/);
  assert.deepEqual(result.dropped.map(d => d.clientSubmissionId), ['csid-a', 'csid-b']);
  assert.equal((await listQueued('fuellog')).length, 0, 'the queue is clear for whatever this worker files next');
});

test("the same queue at a company WITH the module drains normally", async () => {
  await enqueueSubmission('fuellog', 'csid-c', { equipment_label: 'Unit 12 Peterbilt 579', worker_name: 'R. Chen', quantity: 310, quantity_unit: 'L' });
  const result = await drainQueue('fuellog', resubmitThroughHandler(mintToken({ role: 'worker', companyId: 7 })));
  assert.deepEqual(result.dropped, [], 'a company that bought the module loses nothing');
  assert.equal(result.succeeded, 1);
});

// ── The gap the first pass left, found by tenant-scope-reviewer ──────────
//
// break #21 gated ten handlers and skipped api/equipmentreports.js, on the
// reasoning that it was "already an enforcement point". It was — for the
// compliance SECTION inside the report body — but its own four actions
// answered anyone. So api/cron-equipment-reports.js refused to build a
// weekly report on Sunday for a company without Equipment Inspections, and
// on Monday that company's supervisor could call generate_now and get the
// same document. Two entry points to one artifact disagreeing.

const REPORTS_SRC = readFileSync(new URL('../../api/equipmentreports.js', import.meta.url), 'utf8');

test('every weekly-report action gates before it touches the database', () => {
  // Read the source rather than standing up a handler that pulls in jsPDF:
  // what matters is that the guard is present AND ahead of the first query,
  // which is exactly what a later edit would silently get wrong.
  for (const [action, key] of [
    ['list_reports', 'equipment_reports'],
    ['get_report', 'equipment_reports'],
    ['generate_now', 'equipment_reports'],
    ['list_weekly_hours', 'inspection'],
  ]) {
    const start = REPORTS_SRC.indexOf(`if (action === '${action}')`);
    assert.ok(start > 0, `${action} not found`);
    const body = REPORTS_SRC.slice(start, start + 1400);

    const guard = body.indexOf('requireDocKey(supabaseAdmin, session, ');
    assert.ok(guard > 0, `${action} has no requireDocKey guard`);
    assert.ok(
      body.slice(guard, guard + 120).includes(`'${key}'`),
      `${action} must gate on ${key}`,
    );

    const firstQuery = body.indexOf('supabaseAdmin\n      .from(');
    if (firstQuery > 0) {
      assert.ok(guard < firstQuery, `${action} queries before it gates`);
    }
  }
});

test('Weekly Hours gates on inspection, not equipment_reports', () => {
  // It is folded from inspection readings and the Dashboard sub-tab gates it
  // on inspectionsEnabled. Gating the server on equipment_reports instead
  // would lock out a company that bought Inspections but not the report.
  const start = REPORTS_SRC.indexOf("if (action === 'list_weekly_hours')");
  const body = REPORTS_SRC.slice(start, start + 800);
  assert.ok(body.includes("requireDocKey(supabaseAdmin, session, 'inspection')"));
  assert.ok(!body.includes("requireDocKey(supabaseAdmin, session, 'equipment_reports')"));
});

test('a broken session is 401, never 403 — 403 deletes queued work', async () => {
  // A non-admin session with no company is an auth failure, not a billing
  // one. isPermanentRejection drops a 403 for good, so getting this wrong
  // would bin a worker's queued shift over a session glitch.
  const db = stubClient({ data: [], error: null });
  const denied = await requireDocKey(db, { role: 'worker', companyId: null }, 'fuellog');
  assert.equal(denied.status, 401);
  assert.equal(db.calls.length, 0, 'it should not even ask the database');
});

test('the cron can tell "not bought" apart from "could not check"', async () => {
  // Both deny, but only one is the customer's doing. Reporting a failed read
  // as "deactivated" blamed the customer for an outage and hid the real one.
  const { readDocKeySetting } = await import('../../server-lib/docKeyGate.js');
  const off = await readDocKeySetting(stubClient({ data: [{ is_active: false }], error: null }), 7, 'timeclock');
  assert.deepEqual(off, { active: false, unavailable: false });
  const broken = await readDocKeySetting(stubClient({ data: null, error: { message: 'boom' } }), 7, 'timeclock');
  assert.deepEqual(broken, { active: false, unavailable: true });
});
