// Company Portal supervisor reads follow site and author rules (break #47), through
// the REAL handler (api/portal.js) behind a stand-in PostgREST:
//   - department routing still picks the documents
//   - then a supervisor sees only records at their own site(s), written by them, or
//     written by someone in their department or division (the rule every other
//     document uses); the Owner sees everything
//   - detail, edit, delete and email refuse an out-of-scope record with the same
//     generic 403, so the answer never says which check failed
//   - a supervisor of another company never reaches these records at all

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

const P = (id, company, name, role, over = {}) => ({ id, company_id: company, name, role, active: true, is_owner: false, is_lead: false, hide_unassigned: false, departments: [], divisions: [], default_site_id: null, ...over });
const ROSTER = [
  P(1, 7, 'Owner Olly', 'supervisor', { is_owner: true, departments: ['safety'] }),
  P(2, 7, 'Sue Site50', 'supervisor', { departments: ['safety'], default_site_id: 50 }),
  P(3, 7, 'Sam Site70', 'supervisor', { departments: ['safety'], default_site_id: 70 }),
  P(4, 7, 'Dee Dept', 'supervisor', { departments: ['safety', 'yard'], default_site_id: 70 }),
  P(11, 7, 'Writer Wes', 'worker', { departments: ['crew'] }),
  P(12, 7, 'Writer Wendy', 'worker', { departments: ['yard'] }),
  P(90, 8, 'Other Sup', 'supervisor', { departments: ['safety'], default_site_id: 50 }),
];
const DOCS = [{ id: 1, company_id: 7, title: 'Hot Work', icon: 'x', departments: ['safety'] }];
const RECORDS = [
  { id: 100, document_id: 1, site_id: 50, submitted_by_roster_id: 11, submitted_by: 'Writer Wes', created_at: '2026-10-01T00:00:00Z', pdf_url: null },
  { id: 101, document_id: 1, site_id: 60, submitted_by_roster_id: 11, submitted_by: 'Writer Wes', created_at: '2026-10-02T00:00:00Z', pdf_url: null },
  { id: 102, document_id: 1, site_id: 60, submitted_by_roster_id: 12, submitted_by: 'Writer Wendy', created_at: '2026-10-03T00:00:00Z', pdf_url: null },
];
const SITES = [50, 60, 70].map((id) => ({ id, company_id: 7, name: `Site ${id}`, division_id: null }));

const eq = (v) => (v || '').replace(/^eq\./, '');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => r(b)); });
  const wantsObject = (req.headers.accept || '').includes('pgrst.object');
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const rows = (list) => (wantsObject ? send(200, list[0] || {}) : send(200, list));
  const q = (k) => url.searchParams.get(k);
  const filt = (list) => list.filter((r) => {
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
      if (v.startsWith('in.') && !v.slice(4, -1).split(',').includes(String(r[k]))) return false;
    }
    return true;
  });
  if (table === 'roster') return rows(filt(ROSTER));
  if (table === 'portal_documents') return rows(filt(DOCS));
  if (table === 'portal_records') return rows(filt(RECORDS));
  if (table === 'sites') return rows(filt(SITES));
  if (table === 'company_departments') return send(200, [{ company_id: 7, key: 'safety' }, { company_id: 7, key: 'yard' }]);
  if (table === 'document_assignments') return send(200, []);
  if (table === 'portal_answers') return send(200, []);
  if (table === 'portal_questions') return send(200, []);
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: handler } = await import('../../api/portal.js');
test.after(() => new Promise((r) => server.close(r)));

const fakeRes = () => { const o = { statusCode: null, body: null }; return { o, status(c) { o.statusCode = c; return this; }, json(p) { o.body = p; return this; }, setHeader() {}, end() {} }; };
const call = async (body) => { const r = fakeRes(); await handler({ method: 'POST', body, headers: {}, socket: {} }, r); return r.o; };
const as = (userId, companyId = 7) => mintToken({ role: 'supervisor', userId, companyId });
const ids = (out) => (out.body.records || []).map((r) => r.id).sort();

test('a supervisor sees only Portal records at their site, or by their department or division', async () => {
  const sue = await call({ action: 'list_portal_records', token: as(2) });
  assert.equal(sue.statusCode, 200, JSON.stringify(sue.body));
  assert.deepEqual(ids(sue), [100], 'Sue is on site 50 only');
  const sam = await call({ action: 'list_portal_records', token: as(3) });
  assert.deepEqual(ids(sam), [], 'Sam is on site 70, and neither author is in the safety department');
  const dee = await call({ action: 'list_portal_records', token: as(4) });
  assert.deepEqual(ids(dee), [102], 'Dee holds the yard department, which Wendy (author of 102) holds too');
});

test('the Owner sees every record of a routed document', async () => {
  const out = await call({ action: 'list_portal_records', token: as(1) });
  assert.deepEqual(ids(out), [100, 101, 102]);
});

test('record detail refuses an out-of-scope record with the same generic 403', async () => {
  const inScope = await call({ action: 'get_portal_record_detail', token: as(2), recordId: 100 });
  assert.equal(inScope.statusCode, 200, JSON.stringify(inScope.body));
  const outScope = await call({ action: 'get_portal_record_detail', token: as(2), recordId: 101 });
  assert.equal(outScope.statusCode, 403);
  assert.equal(outScope.body.error, 'Not allowed.');
  const missing = await call({ action: 'get_portal_record_detail', token: as(2), recordId: 999 });
  assert.equal(missing.statusCode, 403);
  assert.equal(missing.body.error, outScope.body.error, 'missing and out of scope read alike');
});

test('edit, delete and email refuse a record the supervisor could not have listed', async () => {
  for (const action of ['update_portal_record', 'delete_portal_record']) {
    const no = await call({ action, token: as(2), recordId: 101, answers: [] });
    assert.equal(no.statusCode, 403, `${action} out of scope`);
    assert.equal(no.body.error, 'Not allowed.');
  }
  const email = await call({ action: 'email_portal_record', token: as(2), recordId: 101, department: 'safety' });
  assert.equal(email.statusCode, 403);
});

test('another company\'s supervisor never reaches these records', async () => {
  const list = await call({ action: 'list_portal_records', token: as(90, 8) });
  assert.deepEqual(ids(list), []);
  const detail = await call({ action: 'get_portal_record_detail', token: as(90, 8), recordId: 100 });
  assert.equal(detail.statusCode, 403);
});

test('email: an invalid department never confirms that an out-of-scope record exists', async () => {
  const hidden = await call({ action: 'email_portal_record', token: as(2), recordId: 101, department: 'not-a-department' });
  const missing = await call({ action: 'email_portal_record', token: as(2), recordId: 999, department: 'not-a-department' });
  assert.equal(hidden.statusCode, 403);
  assert.equal(missing.statusCode, 403);
});
