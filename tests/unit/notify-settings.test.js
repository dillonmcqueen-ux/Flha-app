// The Owner's notification switches, through the REAL handler (api/companydata.js)
// behind a stand-in PostgREST:
//   - only the Owner or founder can read or change them
//   - only documents that actually send notices are offered (not Portal documents,
//     not another company's forms, not documents the company has switched off)
//   - "always tell" people must be active people of the same company, capped at 10
//   - saving the switch leaves the list alone, and saving the list leaves the switch alone
//   - the list names people without an email on file, never an address
//   - every change is written to the audit log

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.FIELD_ENCRYPTION_KEY ||= 'a'.repeat(64);

const mintToken = (payload) => {
  const data = Buffer.from(JSON.stringify({ issuedAt: Date.now(), founder: false, ...payload })).toString('base64url');
  return `${data}.${crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url')}`;
};

const R = (id, company, name, role, over = {}) => ({ id, company_id: company, name, role, active: true, is_owner: false, email: 'enc', departments: [], divisions: [], default_site_id: null, ...over });
const ROSTER = [
  R(1, 7, 'Owner Olly', 'supervisor', { is_owner: true }),
  R(2, 7, 'Sup Sam', 'supervisor'),
  R(3, 7, 'Worker Wes', 'worker', { email: null }),
  R(4, 7, 'Gone Gary', 'worker', { active: false }),
  R(90, 8, 'Other Co Worker', 'worker'),
];
const SETTINGS = [
  { company_id: 7, document_key: 'flha', is_active: true },
  { company_id: 7, document_key: 'incident', is_active: true },
  { company_id: 7, document_key: 'fuellog', is_active: true },
];
const CUSTOM = [{ id: 11, company_id: 7, title: 'Yard Walk', is_active: true }, { id: 12, company_id: 8, title: 'Other Co Form', is_active: true }];
const PORTAL = [{ id: 21, company_id: 7, title: 'Hot Work Permit', is_active: true }];
let NOTIFY = [];
const audits = [];

const param = (url, k) => url.searchParams.get(k);
const eq = (v) => (v || '').replace(/^eq\./, '');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => r(b)); });
  const payload = body ? JSON.parse(body) : null;
  const wantsObject = (req.headers.accept || '').includes('pgrst.object');
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const rows = (list) => (wantsObject ? send(200, list[0] || {}) : send(200, list));
  const byCompany = (list) => list.filter((r) => !param(url, 'company_id') || String(r.company_id) === eq(param(url, 'company_id')));

  if (table === 'roster') {
    let list = byCompany(ROSTER).filter((r) => !param(url, 'active') || String(r.active) === eq(param(url, 'active')));
    const id = param(url, 'id');
    if (id && id.startsWith('eq.')) list = list.filter((r) => String(r.id) === eq(id));
    if (id && id.startsWith('in.')) { const ids = id.slice(4, -1).split(','); list = list.filter((r) => ids.includes(String(r.id))); }
    return rows(list);
  }
  if (table === 'company_document_settings') return send(200, byCompany(SETTINGS));
  if (table === 'custom_forms') return send(200, byCompany(CUSTOM));
  if (table === 'portal_documents') return send(200, byCompany(PORTAL));
  if (table === 'audit_log') { audits.push(payload); return send(201, []); }
  if (table === 'document_notifications') {
    if (req.method === 'POST') {
      const row = Array.isArray(payload) ? payload[0] : payload;
      const at = NOTIFY.findIndex((n) => n.company_id === row.company_id && n.document_key === row.document_key);
      if (at >= 0) Object.assign(NOTIFY[at], row); else NOTIFY.push({ enabled: false, extra_roster_ids: [], ...row });
      return send(201, []);
    }
    return send(200, byCompany(NOTIFY));
  }
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: handler } = await import('../../api/companydata.js');
test.after(() => new Promise((r) => server.close(r)));

const fakeRes = () => { const o = { statusCode: null, body: null }; return { o, status(c) { o.statusCode = c; return this; }, json(p) { o.body = p; return this; }, setHeader() {}, end() {} }; };
const call = async (body) => { const r = fakeRes(); await handler({ method: 'POST', body, headers: {}, socket: {} }, r); return r.o; };
const as = (userId, role) => mintToken({ role, userId, companyId: 7 });
const OWNER = () => as(1, 'supervisor');
const set = (over) => call({ action: 'set_document_notification', token: OWNER(), documentKey: 'flha', ...over });

test('only the Owner or founder may read or change notification settings', async () => {
  NOTIFY = [];
  for (const action of ['list_document_notifications', 'set_document_notification']) {
    assert.equal((await call({ action, token: as(2, 'supervisor'), documentKey: 'flha', enabled: true })).statusCode, 403, `${action} as a supervisor`);
    assert.equal((await call({ action, token: as(3, 'worker'), documentKey: 'flha', enabled: true })).statusCode, 403, `${action} as a worker`);
  }
  assert.deepEqual(NOTIFY, []);
});

test('only documents that send notices are offered, with the switch and who has no email', async () => {
  NOTIFY = [{ company_id: 7, document_key: 'flha', enabled: true, extra_roster_ids: [2] }];
  const out = await call({ action: 'list_document_notifications', token: OWNER() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  const keys = out.body.documents.map((d) => d.key).sort();
  assert.deepEqual(keys, ['custom_11', 'flha', 'incident'], 'no Fuel Log, no Portal document, no other company\'s form');
  const flha = out.body.documents.find((d) => d.key === 'flha');
  assert.equal(flha.enabled, true);
  assert.deepEqual(flha.extraRosterIds, [2]);
  assert.equal(out.body.documents.find((d) => d.key === 'incident').enabled, false, 'off until switched on');
  assert.deepEqual(out.body.noEmail, [{ id: 3, name: 'Worker Wes' }], 'active people with no address, by name only');
  assert.ok(!JSON.stringify(out.body).includes('enc'), 'no address in the response');
});

test('the Owner switches a document on and off, and it is audited', async () => {
  NOTIFY = []; audits.length = 0;
  assert.equal((await set({ enabled: true })).statusCode, 200);
  assert.equal(NOTIFY[0].enabled, true);
  assert.equal(NOTIFY[0].company_id, 7);
  assert.equal(NOTIFY[0].updated_by, 1);
  assert.equal((await set({ enabled: false })).statusCode, 200);
  assert.equal(NOTIFY[0].enabled, false);
  assert.ok(audits.some((a) => a && a.action === 'set_document_notification'));
  await set({ extraRosterIds: [2] });
  assert.deepEqual(audits.at(-1).details.extras, [2], 'the audit log names who was added, not just how many');
});

test('a custom form of this company can be switched on, another company\'s cannot', async () => {
  NOTIFY = [];
  assert.equal((await set({ documentKey: 'custom_11', enabled: true })).statusCode, 200);
  assert.equal((await set({ documentKey: 'custom_12', enabled: true })).statusCode, 400);
  assert.equal(NOTIFY.length, 1);
});

test('documents that send nothing are refused', async () => {
  NOTIFY = [];
  for (const documentKey of ['fuellog', 'portal_21', 'timeclock', '../x', 5, undefined]) {
    const out = await set({ documentKey, enabled: true });
    assert.equal(out.statusCode, 400, String(documentKey));
  }
  assert.deepEqual(NOTIFY, []);
});

test('always-tell people must be active members of this company, capped at 10', async () => {
  NOTIFY = [];
  assert.equal((await set({ extraRosterIds: [2, 3] })).statusCode, 200);
  assert.deepEqual(NOTIFY[0].extra_roster_ids, [2, 3]);
  for (const extraRosterIds of [[90], [4], [999], ['x'], [1.5], 'nope', [0], [-1], [true], [[2]], [null]]) {
    assert.equal((await set({ extraRosterIds })).statusCode, 400, JSON.stringify(extraRosterIds));
  }
  assert.deepEqual(NOTIFY[0].extra_roster_ids, [2, 3], 'a refused list changes nothing');
  assert.equal((await set({ extraRosterIds: Array.from({ length: 11 }, (_, i) => i + 1) })).statusCode, 400);
});

test('saving the switch leaves the list alone, and the other way round', async () => {
  NOTIFY = [{ company_id: 7, document_key: 'flha', enabled: true, extra_roster_ids: [2] }];
  await set({ enabled: false });
  assert.deepEqual(NOTIFY[0].extra_roster_ids, [2]);
  await set({ extraRosterIds: [] });
  assert.equal(NOTIFY[0].enabled, false);
  assert.deepEqual(NOTIFY[0].extra_roster_ids, []);
});

test('a bad switch value is refused', async () => {
  NOTIFY = [];
  assert.equal((await set({ enabled: 'yes' })).statusCode, 400);
  assert.deepEqual(NOTIFY, []);
});
