// The access rules inside a REAL handler (api/fuellogs.js) behind a stand-in
// PostgREST, so what is asserted is what the handler puts on the wire:
//   - a worker an assignment excludes is refused BEFORE anything is inserted
//   - a worker an assignment names still submits
//   - a supervisor with no tags sees only their own logs; a supervisor whose
//     default site matches sees that site's logs; the Owner sees everything
//   - a missing document_assignments table (SQL not applied yet) changes
//     nothing

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

function mintToken(payload) {
  const data = Buffer.from(JSON.stringify({ issuedAt: Date.now(), founder: false, ...payload })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

const ROSTER = [
  { id: 5, company_id: 7, name: 'Worker Wes', role: 'worker', active: true, is_owner: false, departments: [], divisions: [], default_site_id: null },
  { id: 21, company_id: 7, name: 'Sup Sam', role: 'supervisor', active: true, is_owner: false, departments: [], divisions: [], default_site_id: null },
  { id: 22, company_id: 7, name: 'Sup Site', role: 'supervisor', active: true, is_owner: false, departments: [], divisions: [], default_site_id: 9 },
  { id: 23, company_id: 7, name: 'Owner Olly', role: 'supervisor', active: true, is_owner: true, departments: [], divisions: [], default_site_id: null },
];
const LOGS = [
  { id: 1, company_id: 7, equipment_label: 'A', worker_name: 'Wes', hour_reading: 10, reading_unit: 'Hours', quantity: 5, site_id: 9, submitted_by_roster_id: 5, created_at: '2026-09-20T15:00:00.000Z' },
  { id: 2, company_id: 7, equipment_label: 'B', worker_name: 'Sam', hour_reading: 11, reading_unit: 'Hours', quantity: 6, site_id: 1, submitted_by_roster_id: 21, created_at: '2026-09-21T15:00:00.000Z' },
  { id: 3, company_id: 7, equipment_label: 'C', worker_name: 'X', hour_reading: 12, reading_unit: 'Hours', quantity: 7, site_id: 2, submitted_by_roster_id: 5, created_at: '2026-09-22T15:00:00.000Z' },
];

let assignments = [];
let assignmentsTableExists = true;
const calls = [];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
  calls.push({ method: req.method, table });
  const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };

  if (table === 'company_document_settings') return send(200, [{ is_active: true }]);
  if (table === 'roster') {
    const id = Number((url.searchParams.get('id') || '').replace('eq.', ''));
    const inList = (url.searchParams.get('id') || '').startsWith('in.');
    if (inList) {
      const ids = url.searchParams.get('id').replace('in.(', '').replace(')', '').split(',').map(Number);
      return send(200, ROSTER.filter(r => ids.includes(r.id)));
    }
    return send(200, ROSTER.filter(r => r.id === id));
  }
  if (table === 'document_assignments') {
    if (!assignmentsTableExists) return send(404, { code: 'PGRST205', message: 'Could not find the table' });
    return send(200, assignments);
  }
  if (table === 'fuel_logs') return req.method === 'POST' ? send(201, [{ id: 99 }]) : send(200, LOGS);
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: handler } = await import('../../api/fuellogs.js');
test.after(() => new Promise(r => server.close(r)));

function fakeRes() {
  const out = { statusCode: null, body: null };
  return { out, status(c) { out.statusCode = c; return this; }, json(p) { out.body = p; return this; } };
}
async function call(body) { const res = fakeRes(); await handler({ method: 'POST', body }, res); return res.out; }

const asRoster = (userId, role) => mintToken({ role, userId, companyId: 7 });
const asg = (over) => ({ document_key: 'fuellog', audience_type: 'everyone', audience_value: null, action: 'submit', due_at: null, created_at: '2026-01-01T00:00:00.000Z', ended_at: null, ...over });
const SUBMIT_BODY = { record: { equipment_label: 'Unit 12', worker_name: 'Wes', quantity: 300, quantity_unit: 'L' } };

test('an excluded worker is refused before anything is inserted', async () => {
  assignments = [asg({ audience_type: 'individual', audience_value: '99' })];
  const before = calls.length;
  const out = await call({ action: 'submit', token: asRoster(5, 'worker'), ...SUBMIT_BODY });
  assert.equal(out.statusCode, 403);
  assert.deepEqual(calls.slice(before).filter(c => c.method === 'POST').map(c => c.table), []);
});

test('a worker the assignment names still submits', async () => {
  assignments = [asg({ audience_type: 'individual', audience_value: '5' })];
  const out = await call({ action: 'submit', token: asRoster(5, 'worker'), ...SUBMIT_BODY });
  assert.notEqual(out.statusCode, 403, JSON.stringify(out.body));
});

test('with no rows at all a worker submits exactly as before', async () => {
  assignments = [];
  const out = await call({ action: 'submit', token: asRoster(5, 'worker'), ...SUBMIT_BODY });
  assert.notEqual(out.statusCode, 403, JSON.stringify(out.body));
});

test('an untagged supervisor sees only their own logs', async () => {
  assignments = [];
  const out = await call({ action: 'list', token: asRoster(21, 'supervisor') });
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.body.records.map(r => r.id), [2]);
});

test('a supervisor whose default site matches sees that site', async () => {
  assignments = [];
  const out = await call({ action: 'list', token: asRoster(22, 'supervisor') });
  assert.deepEqual(out.body.records.map(r => r.id), [1]);
});

test('the Owner sees every log', async () => {
  assignments = [];
  const out = await call({ action: 'list', token: asRoster(23, 'supervisor') });
  assert.deepEqual(out.body.records.map(r => r.id).sort(), [1, 2, 3]);
});

test('a view row narrows a supervisor to its audience, and the Owner is unaffected', async () => {
  assignments = [asg({ action: 'view', audience_type: 'individual', audience_value: '22' })];
  const denied = await call({ action: 'list', token: asRoster(21, 'supervisor') });
  assert.equal(denied.statusCode, 403);
  const named = await call({ action: 'list', token: asRoster(22, 'supervisor') });
  assert.equal(named.statusCode, 200);
  const owner = await call({ action: 'list', token: asRoster(23, 'supervisor') });
  assert.equal(owner.statusCode, 200);
});

test('the founder is never narrowed', async () => {
  assignments = [asg({ audience_type: 'individual', audience_value: '99' }), asg({ action: 'view', audience_type: 'individual', audience_value: '99' })];
  const out = await call({ action: 'list', token: mintToken({ role: 'admin', companyId: null }) });
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.records.length, 3);
  const master = await call({ action: 'list', token: mintToken({ role: 'supervisor', companyId: 7, founder: true }) });
  assert.equal(master.statusCode, 200);
  assert.equal(master.body.records.length, 3);
});

test('a missing document_assignments table (SQL not applied yet) changes nothing for submits', async () => {
  assignmentsTableExists = false;
  try {
    const out = await call({ action: 'submit', token: asRoster(5, 'worker'), ...SUBMIT_BODY });
    assert.notEqual(out.statusCode, 403, JSON.stringify(out.body));
    assert.notEqual(out.statusCode, 503, JSON.stringify(out.body));
  } finally {
    assignmentsTableExists = true;
  }
});
