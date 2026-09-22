// Break #23: Time Clock and the PM interval were gated only in the browser.
//
// The Sunday cron refused to build a weekly time-clock report for a company
// without the Time Clock + GPS module (api/cron-equipment-reports.js), and
// generate_time_report_now built the same report on demand with no check.
// Same shape as #26: two entry points to one artifact disagreeing.
//
// Two carve-outs are deliberate, and pinned here so a later "gate the whole
// block" tidy-up cannot undo them:
//
//   - clock_out (and my_time_status, which the clock-out screen reads to
//     know there is an open shift) stays OPEN. A company that drops the
//     module mid-shift must still be able to close that shift, or it stays
//     open forever.
//   - list_time_entries, list_time_reports and get_time_report stay OPEN.
//     Hours a company already recorded can be payroll records; cancelling
//     the module stops new ones, it does not take the old ones away.
//
// Everything else that creates or changes time-clock data is gated on
// `timeclock`, and set_equipment_pm_interval on `maintenance` (the reads of
// that interval in api/maintenance.js were already gated, so a company
// without the module could set a clock it could not see).
//
// Drives the REAL api/companydata.js handler behind a stand-in PostgREST.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

function mintToken(payload) {
  const data = Buffer.from(JSON.stringify({ issuedAt: Date.now(), ...payload })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

// Company 7 bought Time Clock + GPS and Preventative Maintenance. Company 8
// has both written explicitly off. Company 9 has no rows at all.
const SETTINGS = [
  { company_id: 7, document_key: 'timeclock', is_active: true },
  { company_id: 7, document_key: 'maintenance', is_active: true },
  { company_id: 8, document_key: 'timeclock', is_active: false },
  { company_id: 8, document_key: 'maintenance', is_active: false },
];

// Roster ids encode their company so verifySession's live re-check passes:
// 70/71 belong to company 7, 80/81 to 8, 90/91 to 9. x0 is a worker, x1 a
// supervisor.
function rosterRow(id) {
  const companyId = Math.floor(id / 10);
  return { id, active: true, role: id % 10 === 1 ? 'supervisor' : 'worker', company_id: companyId, name: `Person ${id}` };
}

const calls = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
  calls.push({ method: req.method, table });
  const send = (code, payload) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  const eq = key => (url.searchParams.get(key) || '').replace('eq.', '');

  if (table === 'company_document_settings') {
    const hit = SETTINGS.filter(s => String(s.company_id) === eq('company_id') && s.document_key === eq('document_key'));
    return send(200, hit.map(s => ({ is_active: s.is_active })));
  }
  if (table === 'roster') {
    const id = Number(eq('id'));
    return send(200, id ? [rosterRow(id)] : []);
  }
  if (table === 'time_clock_entries') {
    // Entry ids encode their company (801 belongs to company 8) so a
    // refusal in these tests can only come from the gate, never from the
    // handler's own same-company check. Any other lookup gets an open shift,
    // so clock_out has something to close.
    const id = Number(eq('id'));
    const companyId = id ? Math.floor(id / 100) : 8;
    if (req.method === 'GET') return send(200, [{ id: id || 801, company_id: companyId, clock_in: '2026-09-21T14:00:00.000Z' }]);
    return send(req.method === 'POST' ? 201 : 200, []);
  }
  if (table === 'equipment') {
    const id = Number(eq('id'));
    return send(200, [{ id, company_id: Math.floor(id / 100) }]);
  }
  if (req.method === 'POST') return send(201, []);
  return send(200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(r => server.close(r)));

const { default: handler } = await import('../../api/companydata.js');

async function call(body) {
  const out = { statusCode: null, body: null };
  const res = {
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
  };
  await handler({ method: 'POST', body }, res);
  return out;
}

// Tables a call touched beyond the session and gate lookups.
async function dataTablesTouched(body) {
  const before = calls.length;
  const out = await call(body);
  const touched = calls.slice(before).map(c => c.table).filter(t => t !== 'roster' && t !== 'company_document_settings');
  return { out, touched };
}

const worker = companyId => mintToken({ role: 'worker', companyId, userId: companyId * 10 });
const supervisor = companyId => mintToken({ role: 'supervisor', companyId, userId: companyId * 10 + 1 });

const GATED = [
  ['clock_in', worker, () => ({})],
  ['edit_time_entry', supervisor, c => ({ entryId: c * 100 + 1, clockIn: '2026-09-21T14:00:00.000Z' })],
  ['add_time_entry', supervisor, c => ({ rosterId: c * 10, clockIn: '2026-09-21T14:00:00.000Z' })],
  ['delete_time_entry', supervisor, c => ({ entryId: c * 100 + 1 })],
  ['generate_time_report_now', supervisor, () => ({ weekStart: '2026-09-14' })],
];

for (const [action, who, extra] of GATED) {
  test(`${action} is refused for a company with Time Clock switched OFF, before any data is touched`, async () => {
    const { out, touched } = await dataTablesTouched({ action, token: who(8), ...extra(8) });
    assert.equal(out.statusCode, 403, `${action}: ${JSON.stringify(out.body)}`);
    assert.match(out.body.error, /Time Clock/);
    assert.deepEqual(touched, [], `${action} must not reach time-clock data once refused`);
  });

  test(`${action} is refused for a company with NO settings row (deny-by-default)`, async () => {
    const { out } = await dataTablesTouched({ action, token: who(9), ...extra(9) });
    assert.equal(out.statusCode, 403);
  });
}

test('clock_in still works for a company that bought Time Clock', async () => {
  const out = await call({ action: 'clock_in', token: worker(7) });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
});

test('an admin session is not gated on time-clock actions', async () => {
  const out = await call({ action: 'delete_time_entry', token: mintToken({ role: 'admin' }), entryId: 801 });
  assert.notEqual(out.statusCode, 403, JSON.stringify(out.body));
});

// ── the deliberate carve-outs ────────────────────────────────────────────

test('clock_out stays OPEN — a shift started before the module was dropped can always be closed', async () => {
  const out = await call({ action: 'clock_out', token: worker(8) });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
});

test('my_time_status stays OPEN — the clock-out screen needs it to find the open shift', async () => {
  const out = await call({ action: 'my_time_status', token: worker(8) });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
});

for (const [action, extra] of [
  ['list_time_entries', {}],
  ['list_time_reports', {}],
]) {
  test(`${action} stays OPEN — recorded hours remain readable after the module is dropped`, async () => {
    const out = await call({ action, token: supervisor(8), ...extra });
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  });
}

test('get_time_report is not refused by the module gate', async () => {
  // The fake has no report row, so this answers 404. The point is that it is
  // not the gate's 403.
  const out = await call({ action: 'get_time_report', token: supervisor(8), reportId: 1 });
  assert.notEqual(out.statusCode, 403, JSON.stringify(out.body));
});

// ── the PM interval ──────────────────────────────────────────────────────

test('set_equipment_pm_interval is refused without Preventative Maintenance, before the equipment lookup', async () => {
  const { out, touched } = await dataTablesTouched({ action: 'set_equipment_pm_interval', token: supervisor(8), id: 801, pmInterval: 250 });
  assert.equal(out.statusCode, 403, JSON.stringify(out.body));
  assert.match(out.body.error, /Preventative Maintenance/);
  assert.deepEqual(touched, []);
});

test('set_equipment_pm_interval gates on maintenance, not timeclock', async () => {
  // Company 7 has maintenance ON. Gating on the wrong key would still pass
  // here only if timeclock were also on, so check the negative too: a
  // company with maintenance off is refused regardless of timeclock.
  const out = await call({ action: 'set_equipment_pm_interval', token: supervisor(9), id: 901, pmInterval: 250 });
  assert.equal(out.statusCode, 403);
  assert.match(out.body.error, /Preventative Maintenance/);
});
