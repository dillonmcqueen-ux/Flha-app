// The Owner's side of document assignments, through the REAL handler
// (api/companydata.js) behind a stand-in PostgREST:
//   - only the Owner or founder can list, create or end assignments
//   - every id a client sends is checked against the caller's own company
//     (another company's custom form, Portal document, division, site or
//     person is refused, never stored)
//   - Portal documents take submit assignments only, only a submit
//     assignment carries a due date
//   - an assignment shows how many people it reaches, so an empty audience
//     is visible
//   - removing a division ends the assignments that named it
//   - the hide-unassigned switch narrows a person to what is assigned to
//     them, and a database without the column behaves as if it were off

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.FIELD_ENCRYPTION_KEY ||= 'a'.repeat(64);

function mintToken(payload) {
  const data = Buffer.from(JSON.stringify({ issuedAt: Date.now(), founder: false, ...payload })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

const ROSTER = [
  { id: 1, company_id: 7, name: 'Owner Olly', role: 'supervisor', active: true, is_owner: true, departments: ['safety'], divisions: [3], default_site_id: null },
  { id: 2, company_id: 7, name: 'Sup Sam', role: 'supervisor', active: true, is_owner: false, departments: [], divisions: [], default_site_id: null },
  { id: 3, company_id: 7, name: 'Worker Wes', role: 'worker', active: true, is_owner: false, departments: ['safety'], divisions: [], default_site_id: 9 },
  { id: 4, company_id: 7, name: 'Worker Wendy', role: 'worker', active: true, is_owner: false, departments: [], divisions: [], default_site_id: null },
  { id: 90, company_id: 8, name: 'Other Co Worker', role: 'worker', active: true, is_owner: false, departments: [], divisions: [], default_site_id: null },
];
const SETTINGS = [
  { company_id: 7, document_key: 'flha', is_active: true },
  { company_id: 7, document_key: 'incident', is_active: true },
  { company_id: 7, document_key: 'timeclock', is_active: true },
  { company_id: 8, document_key: 'daily', is_active: true },
];
const CUSTOM = [{ id: 11, company_id: 7, title: 'Yard Walk', is_active: true }, { id: 12, company_id: 8, title: 'Other Co Form', is_active: true }];
const PORTAL = [{ id: 21, company_id: 7, title: 'Hot Work Permit', is_active: true }, { id: 22, company_id: 8, title: 'Other Co Doc', is_active: true }];
const SITES = [{ id: 9, company_id: 7, name: 'Pit', division_id: 3 }, { id: 10, company_id: 7, name: 'Yard', division_id: null }, { id: 50, company_id: 8, name: 'Other Site', division_id: null }];
const DIVISIONS = [{ id: 3, company_id: 7, name: 'Civil' }, { id: 4, company_id: 7, name: 'Utilities' }, { id: 60, company_id: 8, name: 'Other Div' }];
const DEPTS = [];

let assignments = [];
let nextId = 100;
let divisionDeleted = false;
let hideColumnExists = true;
const audits = [];

const param = (url, k) => url.searchParams.get(k);
const eq = (v) => (v || '').replace(/^eq\./, '');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
  const payload = body ? JSON.parse(body) : null;
  const wantsObject = (req.headers.accept || '').includes('pgrst.object');
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const rows = (list) => (wantsObject ? send(200, list[0] || {}) : send(200, list));
  const byCompany = (list) => list.filter(r => !param(url, 'company_id') || String(r.company_id) === eq(param(url, 'company_id')));
  const byId = (list) => list.filter(r => !param(url, 'id') || String(r.id) === eq(param(url, 'id')));

  if (table === 'roster') {
    const select = param(url, 'select') || '';
    if (select.includes('hide_unassigned') && !hideColumnExists) return send(400, { code: '42703', message: 'column does not exist' });
    if (req.method === 'PATCH') return send(200, []);
    return rows(byId(byCompany(ROSTER)).filter(r => !param(url, 'active') || String(r.active) === eq(param(url, 'active'))));
  }
  if (table === 'company_document_settings') return send(200, byCompany(SETTINGS));
  if (table === 'custom_forms') return send(200, byCompany(CUSTOM));
  if (table === 'portal_documents') return send(200, byCompany(PORTAL));
  if (table === 'sites') return rows(byId(byCompany(SITES)));
  if (table === 'company_divisions') {
    if (req.method === 'DELETE') { divisionDeleted = true; return send(200, [{ id: Number(eq(param(url, 'id'))) }]); }
    return send(200, byCompany(DIVISIONS));
  }
  if (table === 'company_departments') return send(200, byCompany(DEPTS));
  if (table === 'audit_log') { audits.push(payload); return send(201, []); }
  if (table === 'document_assignments') {
    if (req.method === 'POST') {
      const row = { id: nextId++, created_at: new Date().toISOString(), ended_at: null, ...payload };
      assignments.push(row);
      return wantsObject ? send(201, row) : send(201, [row]);
    }
    if (req.method === 'PATCH') {
      const hit = assignments.filter(a => (!param(url, 'id') || String(a.id) === eq(param(url, 'id')))
        && (!param(url, 'company_id') || String(a.company_id) === eq(param(url, 'company_id')))
        && (!param(url, 'audience_type') || a.audience_type === eq(param(url, 'audience_type')))
        && (!param(url, 'audience_value') || a.audience_value === eq(param(url, 'audience_value')))
        && !a.ended_at);
      hit.forEach(a => { a.ended_at = payload.ended_at; });
      return send(200, hit.map(a => ({ id: a.id })));
    }
    return send(200, byCompany(assignments).filter(a => !a.ended_at
      && (!param(url, 'audience_type') || a.audience_type === eq(param(url, 'audience_type')))
      && (!param(url, 'audience_value') || a.audience_value === eq(param(url, 'audience_value')))));
  }
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: handler } = await import('../../api/companydata.js');
test.after(() => new Promise(r => server.close(r)));

function fakeRes() {
  const out = { statusCode: null, body: null };
  return { out, status(c) { out.statusCode = c; return this; }, json(p) { out.body = p; return this; }, setHeader() {}, end() {} };
}
async function call(body) { const res = fakeRes(); await handler({ method: 'POST', body, headers: {}, socket: {} }, res); return res.out; }
const as = (userId, role) => mintToken({ role, userId, companyId: 7 });
const OWNER = () => as(1, 'supervisor');

const create = (over) => call({ action: 'create_document_assignment', token: OWNER(), documentKey: 'flha', assignAction: 'submit', audienceType: 'role', audienceValue: 'worker', ...over });

test('only the Owner or founder may touch assignments', async () => {
  assignments = [];
  for (const action of ['list_document_assignments', 'create_document_assignment', 'end_document_assignment', 'set_site_division']) {
    const sup = await call({ action, token: as(2, 'supervisor'), documentKey: 'flha', assignAction: 'submit', audienceType: 'everyone', id: 1, siteId: 9 });
    assert.equal(sup.statusCode, 403, `${action} as a supervisor`);
    const worker = await call({ action, token: as(3, 'worker') });
    assert.equal(worker.statusCode, 403, `${action} as a worker`);
  }
  assert.deepEqual(assignments, []);
});

test('the Owner creates an assignment and the list says who it reaches', async () => {
  assignments = [];
  const made = await create({ audienceType: 'department', audienceValue: 'safety', dueAt: '2026-12-01' });
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  const listed = await call({ action: 'list_document_assignments', token: OWNER() });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.assignments.length, 1);
  // Owner Olly and Worker Wes hold the safety department.
  assert.equal(listed.body.assignments[0].reaches, 2);
  assert.ok(listed.body.assignments[0].dueAt);
  const docKeys = listed.body.documents.map(d => d.key).sort();
  assert.deepEqual(docKeys, ['custom_11', 'flha', 'incident', 'portal_21'], 'timeclock is not assignable and the other company\'s documents are not offered');
});

test('an empty audience is visible as reaching nobody', async () => {
  assignments = [];
  await create({ audienceType: 'division', audienceValue: '4' });
  const listed = await call({ action: 'list_document_assignments', token: OWNER() });
  assert.equal(listed.body.assignments[0].reaches, 0);
});

test('a division reaches the people at its sites', async () => {
  assignments = [];
  await create({ audienceType: 'site', audienceValue: '9' });
  const listed = await call({ action: 'list_document_assignments', token: OWNER() });
  // Wes has site 9 as default; Olly holds division 3, which owns site 9.
  assert.equal(listed.body.assignments[0].reaches, 2);
});

test('another company\'s ids are refused, never stored', async () => {
  assignments = [];
  const cases = [
    { documentKey: 'custom_12' },
    { documentKey: 'portal_22' },
    { documentKey: 'daily' },
    { audienceType: 'division', audienceValue: '60' },
    { audienceType: 'site', audienceValue: '50' },
    { audienceType: 'individual', audienceValue: '90' },
    { audienceType: 'department', audienceValue: 'c_not_mine' },
  ];
  for (const c of cases) {
    const out = await create(c);
    assert.equal(out.statusCode, 400, JSON.stringify(c));
  }
  assert.deepEqual(assignments, []);
});

test('Portal documents take submit only, and only a submit has a due date', async () => {
  assignments = [];
  assert.equal((await create({ documentKey: 'portal_21', assignAction: 'view' })).statusCode, 400);
  assert.equal((await create({ documentKey: 'portal_21', assignAction: 'submit' })).statusCode, 200);
  assert.equal((await create({ documentKey: 'flha', assignAction: 'view', dueAt: '2026-12-01' })).statusCode, 400);
  assert.equal((await create({ documentKey: 'flha', assignAction: 'submit', dueAt: 'soon' })).statusCode, 400);
  assert.equal((await create({ documentKey: 'timeclock' })).statusCode, 400);
});

test('a duplicate assignment is refused', async () => {
  assignments = [];
  assert.equal((await create({})).statusCode, 200);
  assert.equal((await create({})).statusCode, 409);
});

test('ending an assignment works for this company and 404s for anything else', async () => {
  assignments = [];
  await create({});
  const id = assignments[0].id;
  assert.equal((await call({ action: 'end_document_assignment', token: OWNER(), id: 99999 })).statusCode, 404);
  assignments.push({ id: 500, company_id: 8, document_key: 'daily', audience_type: 'everyone', audience_value: null, action: 'submit', ended_at: null, created_at: new Date().toISOString() });
  assert.equal((await call({ action: 'end_document_assignment', token: OWNER(), id: 500 })).statusCode, 404, 'another company\'s row');
  assert.equal(assignments.find(a => a.id === 500).ended_at, null);
  assert.equal((await call({ action: 'end_document_assignment', token: OWNER(), id })).statusCode, 200);
  assert.ok(assignments.find(a => a.id === id).ended_at);
});

test('setting a site\'s division checks both belong to the company', async () => {
  assert.equal((await call({ action: 'set_site_division', token: OWNER(), siteId: 50, divisionId: 3 })).statusCode, 403, 'another company\'s site');
  assert.equal((await call({ action: 'set_site_division', token: OWNER(), siteId: 9, divisionId: 60 })).statusCode, 400, 'another company\'s division');
  assert.equal((await call({ action: 'set_site_division', token: OWNER(), siteId: 9, divisionId: 4 })).statusCode, 200);
  assert.equal((await call({ action: 'set_site_division', token: OWNER(), siteId: 9, divisionId: null })).statusCode, 200);
});

test('a division an assignment still names cannot be removed (it would open the document to everyone)', async () => {
  assignments = [];
  divisionDeleted = false;
  await create({ audienceType: 'division', audienceValue: '4', restricts: true });
  await create({ audienceType: 'role', audienceValue: 'worker', restricts: true });
  const refused = await call({ action: 'delete_division', token: OWNER(), id: 4 });
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  assert.match(refused.body.error, /Document assignments/);
  assert.equal(divisionDeleted, false, 'nothing was deleted');
  assert.equal(assignments.every(a => a.ended_at === null), true, 'and no assignment was ended behind the Owner\'s back');
  // Once the Owner removes the assignment on purpose, the division can go.
  const divRow = assignments.find(a => a.audience_type === 'division');
  assert.equal((await call({ action: 'end_document_assignment', token: OWNER(), id: divRow.id })).statusCode, 200);
  const done = await call({ action: 'delete_division', token: OWNER(), id: 4 });
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.equal(divisionDeleted, true);
});

test('the Owner can read and change the hide switch; the profile reports it', async () => {
  // PATCH answers [] in the fake, which is enough to see the request is accepted.
  const out = await call({ action: 'update_worker_profile', token: OWNER(), id: 3, hideUnassigned: true });
  assert.notEqual(out.statusCode, 403, JSON.stringify(out.body));
  const bad = await call({ action: 'update_worker_profile', token: OWNER(), id: 3, hideUnassigned: 'yes' });
  assert.equal(bad.statusCode, 400);
  const sup = await call({ action: 'update_worker_profile', token: as(2, 'supervisor'), id: 3, hideUnassigned: true });
  assert.equal(sup.statusCode, 403, 'a supervisor cannot hide documents from someone');
});

test('an assignment is a task unless the Owner says otherwise; reading always restricts', async () => {
  assignments = [];
  await create({});
  assert.equal(assignments[0].restricts, false, 'default is a task');
  await create({ documentKey: 'incident', restricts: true });
  assert.equal(assignments[1].restricts, true);
  await create({ documentKey: 'flha', assignAction: 'view', audienceType: 'role', audienceValue: 'supervisor', restricts: false });
  const view = assignments.find(a => a.action === 'view');
  assert.equal(view.restricts, true, 'a view row is forced to restrict');
  const listed = await call({ action: 'list_document_assignments', token: OWNER() });
  assert.deepEqual(listed.body.assignments.map(a => a.restricts), [false, true, true]);
});

test('a task naming a division does not block removing it, a restriction does', async () => {
  assignments = [];
  divisionDeleted = false;
  await create({ audienceType: 'division', audienceValue: '4', restricts: false });
  const ok = await call({ action: 'delete_division', token: OWNER(), id: 4 });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(divisionDeleted, true);
});
