// The auditor, through the REAL handlers behind a stand-in PostgREST:
//   - api/audit.js is the only endpoint an auditor session reaches; every other
//     endpoint treats the role as no session
//   - what they read is the chosen document types at the chosen sites (a
//     division expands to its sites), filtered in the query, never more
//   - access is time-limited and re-checked on every request; revoking or an
//     expired window stops them on the next call
//   - only the Owner manages auditors; every id is checked against the company
//   - auditors never count toward the seat cap, and login refuses an expired one

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.FIELD_ENCRYPTION_KEY ||= 'a'.repeat(64);

const sign = (payload) => {
  const data = Buffer.from(JSON.stringify({ issuedAt: Date.now(), founder: false, ...payload })).toString('base64url');
  return `${data}.${crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url')}`;
};

const DAY = 24 * 3600 * 1000;
const future = () => new Date(Date.now() + 5 * DAY).toISOString();
const past = () => new Date(Date.now() - DAY).toISOString();

const P = (over) => ({ company_id: 7, active: true, is_owner: false, role: 'worker', departments: [], divisions: [], default_site_id: null, email: null, ...over });
const ROSTER = [
  P({ id: 1, name: 'Owner Olly', role: 'supervisor', is_owner: true }),
  P({ id: 2, name: 'Sup Sam', role: 'supervisor' }),
  P({ id: 3, name: 'Worker Wes' }),
  P({ id: 20, name: 'Audit Ann', role: 'auditor', auditor_access_expires_at: future() }),
  P({ id: 21, name: 'Expired Ed', role: 'auditor', auditor_access_expires_at: past() }),
  P({ id: 22, name: 'Unsent Una', role: 'auditor', auditor_access_expires_at: null }),
  P({ id: 23, name: 'Empty Eli', role: 'auditor', auditor_access_expires_at: future() }),
  P({ id: 90, name: 'Other Co Auditor', role: 'auditor', company_id: 8, auditor_access_expires_at: future() }),
];
let SCOPES = [
  { roster_id: 20, company_id: 7, division_ids: [3], site_ids: [10], document_keys: ['flha', 'daily', 'custom_11'] },
  { roster_id: 21, company_id: 7, division_ids: [], site_ids: [9], document_keys: ['flha'] },
];
const SITES = [
  { id: 9, company_id: 7, name: 'Pit', division_id: 3 },
  { id: 10, company_id: 7, name: 'Yard', division_id: null },
  { id: 11, company_id: 7, name: 'Shop', division_id: null },
  { id: 50, company_id: 8, name: 'Other Site', division_id: null },
];
const DIVISIONS = [{ id: 3, company_id: 7, name: 'Civil' }, { id: 60, company_id: 8, name: 'Other Div' }];
const SETTINGS = ['flha', 'daily', 'monthly', 'incident'].map(k => ({ company_id: 7, document_key: k, is_active: true }));
const FLHAS = [
  { id: 1, company_id: 7, job_site: 'Pit', site_id: 9, created_at: '2026-10-01T10:00:00Z', pdf_url: null, status: 'complete', submitted_by_roster_id: 3 },
  { id: 2, company_id: 7, job_site: 'Yard', site_id: 10, created_at: '2026-10-02T10:00:00Z', pdf_url: null, status: 'complete', submitted_by_roster_id: 3 },
  { id: 3, company_id: 7, job_site: 'Shop', site_id: 11, created_at: '2026-10-03T10:00:00Z', pdf_url: null, status: 'complete', submitted_by_roster_id: 3 },
  { id: 4, company_id: 7, job_site: 'Nowhere', site_id: null, created_at: '2026-10-04T10:00:00Z', pdf_url: null, status: 'complete', submitted_by_roster_id: 3 },
  { id: 5, company_id: 8, job_site: 'Other', site_id: 50, created_at: '2026-10-05T10:00:00Z', pdf_url: null, status: 'complete', submitted_by_roster_id: 90 },
];
FLHAS.push({ id: 6, company_id: 7, job_site: 'Pit', site_id: 9, created_at: '2026-10-06T10:00:00Z', pdf_url: null, status: 'complete', submitted_by_roster_id: 3, awaiting_signature: true });
const INCIDENTS = [{ id: 7, company_id: 7, site: 'Pit', site_id: 9, created_at: '2026-10-02T11:00:00Z', pdf_url: null, submitted_by_roster_id: 3 }];
const CUSTOM_FORMS = [{ id: 11, company_id: 7, title: 'Yard Walk' }, { id: 12, company_id: 8, title: 'Other Form' }];
const CUSTOM_RECORDS = [{ id: 31, form_id: 11, site_id: 10, created_at: '2026-10-03T09:00:00Z', pdf_url: null }, { id: 32, form_id: 11, site_id: 11, created_at: '2026-10-03T08:00:00Z', pdf_url: null }];

const ENGINE_SETTINGS = [{ company_id: 7, definition_id: 55, is_enabled: true }, { company_id: 7, definition_id: 56, is_enabled: false }];
const ENGINE_DEFS = [
  { id: 55, title: 'Yard Check', company_id: 7, current_version_id: 1, archived_at: null },
  { id: 56, title: 'Switched Off', company_id: 7, current_version_id: 2, archived_at: null },
];
const ENGINE_RECORDS = [
  { id: 1, company_id: 7, definition_id: 55, site_id: 10, status: 'submitted', awaiting_signature: false, created_at: '2026-10-07T10:00:00Z', pdf_path: '7/abc-doc.pdf' },
  { id: 2, company_id: 7, definition_id: 55, site_id: 10, status: 'pending_approval', awaiting_signature: false, created_at: '2026-10-07T11:00:00Z', pdf_path: null },
  { id: 3, company_id: 7, definition_id: 55, site_id: 11, status: 'submitted', awaiting_signature: false, created_at: '2026-10-07T12:00:00Z', pdf_path: null },
  { id: 4, company_id: 7, definition_id: 55, site_id: 10, status: 'submitted', awaiting_signature: true, created_at: '2026-10-07T13:00:00Z', pdf_path: null },
  { id: 5, company_id: 7, definition_id: 55, site_id: 10, status: 'approved', awaiting_signature: false, created_at: '2026-10-08T10:00:00Z', pdf_path: null },
  { id: 6, company_id: 7, definition_id: 55, site_id: 10, status: 'returned', awaiting_signature: false, created_at: '2026-10-08T11:00:00Z', pdf_path: null },
  { id: 7, company_id: 8, definition_id: 55, site_id: 10, status: 'submitted', awaiting_signature: false, created_at: '2026-10-08T12:00:00Z', pdf_path: null },
];

const writes = [];
const sentEmails = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
  const payload = body ? JSON.parse(body) : null;
  const wantsObject = (req.headers.accept || '').includes('pgrst.object');
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const eq = (k) => { const v = url.searchParams.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  const inList = (k) => { const v = url.searchParams.get(k); return v && v.startsWith('in.(') ? v.slice(4, -1).split(',') : null; };
  const filt = (list) => list.filter(r =>
    (eq('id') === null || String(r.id) === eq('id')) &&
    (eq('company_id') === null || String(r.company_id) === eq('company_id')) &&
    (eq('active') === null || String(r.active) === eq('active')) &&
    (eq('role') === null || r.role === eq('role')) &&
    (eq('awaiting_signature') === null || String(r.awaiting_signature === true) === eq('awaiting_signature')) &&
    (eq('roster_id') === null || String(r.roster_id) === eq('roster_id')) &&
    (inList('id') === null || inList('id').includes(String(r.id))) &&
    (inList('site_id') === null || inList('site_id').includes(String(r.site_id))) &&
    (inList('division_id') === null || inList('division_id').includes(String(r.division_id))) &&
    (inList('form_id') === null || inList('form_id').includes(String(r.form_id))) &&
    (inList('definition_id') === null || inList('definition_id').includes(String(r.definition_id))) &&
    (inList('status') === null || inList('status').includes(String(r.status))) &&
    (eq('is_enabled') === null || String(r.is_enabled) === eq('is_enabled')));
  if (req.method !== 'GET' && table !== 'audit_log') writes.push({ method: req.method, table, payload });

  if (table === 'roster') {
    if (req.method === 'PATCH') {
      const row = ROSTER.find(r => String(r.id) === eq('id'));
      if (row && payload) Object.assign(row, payload);
      return send(200, row ? [row] : []);
    }
    if (req.method === 'POST') { const row = { id: 300, ...payload }; ROSTER.push(P({ ...row })); return wantsObject ? send(201, row) : send(201, [row]); }
    return wantsObject ? send(200, filt(ROSTER)[0] || {}) : send(200, filt(ROSTER));
  }
  if (table === 'auditor_scopes') {
    if (req.method === 'POST') { SCOPES = SCOPES.filter(s => s.roster_id !== payload.roster_id).concat(payload); return send(201, []); }
    return send(200, filt(SCOPES));
  }
  if (table === 'sites') return send(200, filt(SITES));
  if (table === 'company_divisions') return send(200, filt(DIVISIONS));
  if (table === 'company_departments') return send(200, []);
  if (table === 'company_document_settings') return send(200, filt(SETTINGS).filter(s => !eq('document_key') || s.document_key === eq('document_key')));
  if (table === 'flhas') return send(200, filt(FLHAS));
  if (table === 'incidents') return send(200, filt(INCIDENTS));
  if (table === 'custom_forms') return send(200, filt(CUSTOM_FORMS));
  if (table === 'custom_form_records') return send(200, filt(CUSTOM_RECORDS));
  if (table === 'company_documents') return send(200, filt(ENGINE_SETTINGS));
  if (table === 'document_definitions') return send(200, filt(ENGINE_DEFS));
  if (table === 'document_records') return send(200, filt(ENGINE_RECORDS));
  if (table === 'companies') return send(200, [{ name: 'ABC Earthworks', plan_tier: 'basic' }]);
  if (table === 'rpc/claim_pin_attempt') return send(200, [{ id: 1 }]);
  if (table.startsWith('rpc/')) return send(200, true);
  if (table === 'audit_log') return send(201, []);
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: audit } = await import('../../api/audit.js');
const { default: companydata } = await import('../../api/companydata.js');
const { default: flhas } = await import('../../api/flhas.js');
const { default: customforms } = await import('../../api/customforms.js');
const { default: login } = await import('../../api/login.js');
test.after(() => new Promise(r => server.close(r)));

function fakeRes() {
  const out = { statusCode: null, body: null };
  return { out, status(c) { out.statusCode = c; return this; }, json(p) { out.body = p; return this; }, setHeader() {}, end() {} };
}
const run = async (handler, body) => { const r = fakeRes(); await handler({ method: 'POST', body, headers: {}, socket: {} }, r); return r.out; };
const as = (userId, role) => sign({ role, userId, companyId: 7 });
const AUDITOR = () => as(20, 'auditor');
const OWNER = () => as(1, 'supervisor');

test('an auditor reads the chosen types at the chosen sites, and a division reaches its sites', async () => {
  const out = await run(audit, { action: 'list_audit_documents', token: AUDITOR() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  const ids = out.body.documents.map(d => `${d.type}:${d.id}`).sort();
  // FLHAs at the Pit (via division Civil) and the Yard (named); the Yard Walk record at the Yard.
  // Not the Shop, not a site-less FLHA, not another company's, and not the incident (not in scope).
  assert.deepEqual(ids, ['customform:31', 'flha:1', 'flha:2']);
});

test('filters can only narrow what the scope allows', async () => {
  const byKey = await run(audit, { action: 'list_audit_documents', token: AUDITOR(), documentKey: 'flha' });
  assert.deepEqual(byKey.body.documents.map(d => d.id).sort(), [1, 2]);
  const notAllowed = await run(audit, { action: 'list_audit_documents', token: AUDITOR(), documentKey: 'incident' });
  assert.deepEqual(notAllowed.body.documents, []);
  const siteOutside = await run(audit, { action: 'list_audit_documents', token: AUDITOR(), siteId: 11 });
  assert.deepEqual(siteOutside.body.documents, []);
  const siteInside = await run(audit, { action: 'list_audit_documents', token: AUDITOR(), siteId: 10 });
  assert.deepEqual(siteInside.body.documents.map(d => `${d.type}:${d.id}`).sort(), ['customform:31', 'flha:2']);
});

test('the scope summary names the sites and documents, never anything else', async () => {
  const out = await run(audit, { action: 'get_audit_scope', token: AUDITOR() });
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.body.sites.map(s => s.name).sort(), ['Pit', 'Yard']);
  assert.deepEqual(out.body.documents.map(d => d.key).sort(), ['custom_11', 'daily', 'flha']);
  assert.ok(out.body.expiresAt);
});

test('an expired, unsent or empty auditor reads nothing', async () => {
  assert.equal((await run(audit, { action: 'list_audit_documents', token: as(21, 'auditor') })).statusCode, 401, 'expired');
  assert.equal((await run(audit, { action: 'list_audit_documents', token: as(22, 'auditor') })).statusCode, 401, 'never sent');
  const empty = await run(audit, { action: 'list_audit_documents', token: as(23, 'auditor') });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.body.documents, [], 'granted nothing, sees nothing');
});

test('only a real auditor reaches api/audit.js, and the token proves nothing on its own', async () => {
  for (const [id, role] of [[3, 'worker'], [2, 'supervisor'], [1, 'supervisor']]) {
    assert.equal((await run(audit, { action: 'list_audit_documents', token: as(id, role) })).statusCode, 401, role);
  }
  // A token that CLAIMS auditor for a worker's roster row.
  assert.equal((await run(audit, { action: 'list_audit_documents', token: as(3, 'auditor') })).statusCode, 403);
  // Another company's auditor id under this company.
  assert.equal((await run(audit, { action: 'list_audit_documents', token: as(90, 'auditor') })).statusCode, 403);
  assert.equal((await run(audit, { action: 'list_audit_documents', token: 'garbage' })).statusCode, 401);
  assert.equal((await run(audit, { action: 'delete_everything', token: AUDITOR() })).statusCode, 400, 'there is nothing to call but the two reads');
});

test('every other endpoint treats an auditor session as no session', async () => {
  const t = AUDITOR();
  for (const [handler, body] of [
    [flhas, { action: 'list' }],
    [companydata, { action: 'list_sites' }],
    [companydata, { action: 'get_company_logo' }],
    [customforms, { action: 'get_worker_documents' }],
    [customforms, { action: 'list_forms' }],
  ]) {
    const out = await run(handler, { ...body, token: t });
    assert.equal(out.statusCode, 401, body.action);
  }
});

test('only the Owner manages auditors', async () => {
  for (const action of ['list_auditors', 'create_auditor', 'set_auditor_scope', 'send_auditor_access', 'revoke_auditor_access']) {
    for (const [id, role] of [[2, 'supervisor'], [3, 'worker']]) {
      assert.equal((await run(companydata, { action, token: as(id, role), rosterId: 20 })).statusCode, 403, `${action} as ${role}`);
    }
  }
});

test('the Owner adds an auditor, who takes no seat', async () => {
  const before = ROSTER.length;
  const out = await run(companydata, { action: 'create_auditor', token: OWNER(), name: 'New Auditor', email: 'new@auditfirm.example' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(ROSTER.length, before + 1);
  const created = ROSTER[ROSTER.length - 1];
  assert.equal(created.role, 'auditor');
  assert.equal((await run(companydata, { action: 'create_auditor', token: OWNER(), name: '', email: 'x@y.example' })).statusCode, 400);
  assert.equal((await run(companydata, { action: 'create_auditor', token: OWNER(), name: 'Bad Email', email: 'nope' })).statusCode, 400);
  const roster = await run(companydata, { action: 'list_roster', token: OWNER() });
  const nonAuditors = roster.body.members.filter(m => m.active && m.role !== 'auditor').length;
  assert.equal(roster.body.activeSeatCount, nonAuditors, 'auditors are not counted toward the seat cap');
});

test('a scope is checked against the company: other companies\' divisions, sites and forms are refused', async () => {
  const bad = [
    { divisionIds: [60] },
    { siteIds: [50] },
    { documentKeys: ['custom_12'] },
    { documentKeys: ['timeclock'] },
    { documentKeys: ['inspection'] },
    { documentKeys: ['portal_1'] },
  ];
  for (const b of bad) {
    const out = await run(companydata, { action: 'set_auditor_scope', token: OWNER(), rosterId: 22, divisionIds: [], siteIds: [], documentKeys: [], ...b });
    assert.equal(out.statusCode, 400, JSON.stringify(b));
  }
  assert.equal((await run(companydata, { action: 'set_auditor_scope', token: OWNER(), rosterId: 90, siteIds: [9], documentKeys: ['flha'], divisionIds: [] })).statusCode, 404, 'another company\'s auditor');
  assert.equal((await run(companydata, { action: 'set_auditor_scope', token: OWNER(), rosterId: 3, siteIds: [9], documentKeys: ['flha'], divisionIds: [] })).statusCode, 404, 'a worker is not an auditor');
  const ok = await run(companydata, { action: 'set_auditor_scope', token: OWNER(), rosterId: 22, divisionIds: [3], siteIds: [10], documentKeys: ['flha', 'custom_11'] });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.deepEqual(SCOPES.find(s => s.roster_id === 22).document_keys, ['flha', 'custom_11']);
});

test('access is sent for 14 days, only with something to read and an email, and can be ended', async () => {
  // No scope yet: refused.
  assert.equal((await run(companydata, { action: 'send_auditor_access', token: OWNER(), rosterId: 23 })).statusCode, 400);
  // No email on file: refused.
  const noEmail = await run(companydata, { action: 'send_auditor_access', token: OWNER(), rosterId: 20 });
  assert.equal(noEmail.statusCode, 400);
  // Give Una an email (encrypted the way the app stores it) and a scope, then send.
  const { encryptField } = await import('../../server-lib/fieldCrypto.js');
  ROSTER.find(r => r.id === 22).email = encryptField('una@auditfirm.example');
  const sent = await run(companydata, { action: 'send_auditor_access', token: OWNER(), rosterId: 22 });
  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  const days = (Date.parse(sent.body.expiresAt) - Date.now()) / DAY;
  assert.ok(days > 13.9 && days <= 14.01, `14 days, got ${days}`);
  assert.equal(Date.parse(ROSTER.find(r => r.id === 22).auditor_access_expires_at) > Date.now(), true);
  // Una now reads (scope was set above).
  assert.equal((await run(audit, { action: 'get_audit_scope', token: as(22, 'auditor') })).statusCode, 200);
  // Ending it stops the next call.
  assert.equal((await run(companydata, { action: 'revoke_auditor_access', token: OWNER(), rosterId: 22 })).statusCode, 200);
  assert.equal((await run(audit, { action: 'get_audit_scope', token: as(22, 'auditor') })).statusCode, 401);
});

test('an auditor whose access has ended cannot sign in', async () => {
  const ticket = sign({ purpose: 'roster', companyId: 7, companyName: 'ABC Earthworks' });
  const salt = 'salt-for-test';
  const hash = crypto.scryptSync('123457', salt, 64).toString('hex');
  const expired = ROSTER.find(r => r.id === 21);
  expired.pin_salt = salt; expired.pin_hash = hash; expired.totp_enabled = false;
  const out = await run(login, { action: 'roster_login', companyTicket: ticket, rosterId: 21, pin: '123457' });
  assert.equal(out.statusCode, 403, JSON.stringify(out.body));
  assert.match(out.body.error, /audit access has ended/);
  assert.equal(out.body.token, undefined);
});

test('an auditor is never handed a record still awaiting its author\'s signature', async () => {
  const out = await run(audit, { action: 'list_audit_documents', token: AUDITOR(), documentKey: 'flha' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  const ids = out.body.documents.map(d => d.id);
  assert.ok(!ids.includes(6), 'the unsigned FLHA at an allowed site is hidden');
  assert.ok(ids.includes(1), 'signed ones at the same site still show');
});


test('an auditor sees only filed engine records, at their sites, for documents still switched on', async () => {
  const scope = SCOPES.find(x => x.roster_id === 20);
  const before = [...scope.document_keys];
  scope.document_keys = [...before, 'engine_55', 'engine_56'];
  try {
    const sc = await run(audit, { action: 'get_audit_scope', token: AUDITOR() });
    assert.ok(sc.body.documents.some(d => d.key === 'engine_55' && d.label === 'Yard Check'));
    assert.equal(sc.body.documents.some(d => d.key === 'engine_56'), false, 'a document switched off is not offered');

    const out = await run(audit, { action: 'list_audit_documents', token: AUDITOR(), documentKey: 'engine_55' });
    assert.equal(out.statusCode, 200);
    const ids = out.body.documents.map(d => d.id).sort();
    // Filed (submitted or approved) at site 10 only: 1 and 5. Not pending, unsigned, returned, another site, or another company.
    assert.deepEqual(ids, [1, 5]);
    assert.ok(out.body.documents.every(d => d.type === 'engine' && d.title === 'Yard Check' && d.site === 'Yard'));
    const off = await run(audit, { action: 'list_audit_documents', token: AUDITOR(), documentKey: 'engine_56' });
    assert.deepEqual(off.body.documents, []);
  } finally { scope.document_keys = before; }
});

test('only the Owner can pick an engine document for an auditor, and only one this company has on', async () => {
  const ok = await run(companydata, { action: 'set_auditor_scope', token: OWNER(), rosterId: 20, siteIds: [10], documentKeys: ['engine_55'] });
  assert.notEqual(ok.statusCode, 400, JSON.stringify(ok.body));
  const bad = await run(companydata, { action: 'set_auditor_scope', token: OWNER(), rosterId: 20, siteIds: [10], documentKeys: ['engine_56'] });
  assert.equal(bad.statusCode, 400);
});
