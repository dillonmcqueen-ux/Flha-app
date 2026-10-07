// "Worker signs afterwards" (server-lib/signLater.js), FLHA first, through the
// REAL api/flhas.js handler behind a stand-in PostgREST:
//   - a worker can save an FLHA to sign later; it is stored unsigned, flagged,
//     and carries no signature image whatever the request sent
//   - an unsigned FLHA cannot be approved, by a supervisor, a lead or admin
//   - only the person it is stamped to can sign it, from the database row
//   - a founder session (no individual identity) cannot sign later
//   - a database without the columns refuses a sign-later save (fail closed)
//     and an ordinary save is untouched

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
  return `${data}.${crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url')}`;
}

const P = (over) => ({ company_id: 7, active: true, is_owner: false, is_lead: false, hide_unassigned: false, departments: [], divisions: [], default_site_id: null, ...over });
const ROSTER = [
  P({ id: 2, name: 'Sup Sam', role: 'supervisor', departments: ['safety'] }),
  P({ id: 10, name: 'Lead Lee', role: 'worker', is_lead: true, departments: ['safety'] }),
  P({ id: 11, name: 'Crew Cam', role: 'worker', departments: ['safety'] }),
  P({ id: 12, name: 'Other Oz', role: 'worker' }),
];
const SETTINGS = ['flha'].map(k => ({ company_id: 7, document_key: k, is_active: true }));
let FLHAS;
let columnsExist = true;
const reset = () => {
  columnsExist = true;
  FLHAS = [
    { id: 201, company_id: 7, worker_name: 'Crew Cam', job_site: 'Pit', site_id: null, status: 'pending_approval', submitted_by_roster_id: 11, created_at: '2026-10-01T10:00:00Z', hazards_json: { hazards: [{ risk: 'Extreme' }] }, pdf_url: null, worker_signature: null, awaiting_signature: true, signature_requested_at: '2026-10-01T10:00:00Z' },
    { id: 202, company_id: 7, worker_name: 'Crew Cam', job_site: 'Pit', site_id: null, status: 'pending_approval', submitted_by_roster_id: 11, created_at: '2026-10-02T10:00:00Z', hazards_json: { hazards: [{ risk: 'Extreme' }] }, pdf_url: null, worker_signature: 'data:image/png;base64,AAAA', awaiting_signature: false, signature_requested_at: null },
  ];
};
reset();
const inserts = [];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  const body = await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
  const payload = body ? JSON.parse(body) : null;
  const wantsObject = (req.headers.accept || '').includes('pgrst.object');
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const eq = (k) => { const v = url.searchParams.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  const filt = (list) => list.filter(r =>
    (eq('id') === null || String(r.id) === eq('id')) &&
    (eq('company_id') === null || String(r.company_id) === eq('company_id')) &&
    (eq('active') === null || String(r.active) === eq('active')) &&
    (eq('role') === null || r.role === eq('role')));
  const select = url.searchParams.get('select') || '';
  const touchesSignColumns = /awaiting_signature|signature_requested_at|worker_signed_at/.test(select) || (payload && !Array.isArray(payload) && ('awaiting_signature' in payload || 'worker_signed_at' in payload));

  if (table === 'roster') return wantsObject ? send(200, filt(ROSTER)[0] || {}) : send(200, filt(ROSTER));
  if (table === 'company_document_settings') return send(200, filt(SETTINGS).filter(s => !eq('document_key') || s.document_key === eq('document_key')));
  if (table === 'flhas') {
    if (touchesSignColumns && !columnsExist) return send(400, { code: '42703', message: 'column "awaiting_signature" does not exist' });
    if (req.method === 'POST') {
      const row = { id: 300 + inserts.length, ...payload };
      inserts.push(row); FLHAS.push(row);
      return wantsObject ? send(201, { id: row.id, status: row.status }) : send(201, [{ id: row.id, status: row.status }]);
    }
    if (req.method === 'PATCH') {
      const hit = filt(FLHAS).filter(r => (eq('submitted_by_roster_id') === null || String(r.submitted_by_roster_id) === eq('submitted_by_roster_id')) && (eq('awaiting_signature') === null || String(r.awaiting_signature) === eq('awaiting_signature')));
      hit.forEach(r => Object.assign(r, payload));
      return send(200, hit.map(r => ({ id: r.id })));
    }
    if (req.method === 'DELETE') return send(200, []);
    const rows = filt(FLHAS).filter(r => (eq('submitted_by_roster_id') === null || String(r.submitted_by_roster_id) === eq('submitted_by_roster_id')) && (eq('awaiting_signature') === null || String(r.awaiting_signature) === eq('awaiting_signature')));
    return send(200, rows);
  }
  if (table === 'document_assignments') return send(200, []);
  if (table === 'audit_log') return send(201, []);
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: flhas } = await import('../../api/flhas.js');
const signLater = await import('../../server-lib/signLater.js');
test.after(() => new Promise(r => server.close(r)));

function fakeRes() {
  const out = { statusCode: null, body: null };
  return { out, status(c) { out.statusCode = c; return this; }, json(p) { out.body = p; return this; }, setHeader() {}, end() {} };
}
const run = async (body) => { const r = fakeRes(); await flhas({ method: 'POST', body, headers: {}, socket: {} }, r); return r.out; };
const as = (userId, role) => mintToken({ role, userId, companyId: 7 });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const record = (extra = {}) => ({ worker_name: 'Crew Cam', job_site: 'Pit', hazards_json: { hazards: [{ risk: 'Low' }] }, task_description: 't', signed_by: 'Crew Cam', worker_signature: PNG, ...extra });

test('cleanSignature accepts a PNG data URL and nothing else', () => {
  assert.equal(signLater.cleanSignature(PNG), PNG);
  for (const bad of [null, undefined, 5, '', 'hello', 'data:text/html;base64,AAAA', 'data:image/png;base64,AA AA', `data:image/png;base64,${'A'.repeat(400001)}`]) {
    assert.equal(signLater.cleanSignature(bad), null, String(bad).slice(0, 30));
  }
});

test('signatureOverdue: a day, and only with a real timestamp', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  assert.equal(signLater.signatureOverdue('2026-10-04T11:59:00Z', now), true);
  assert.equal(signLater.signatureOverdue('2026-10-04T12:01:00Z', now), false);
  assert.equal(signLater.signatureOverdue(null, now), false);
  assert.equal(signLater.signatureOverdue('garbage', now), false);
});

test('submit with sign_later: stored unsigned and flagged, whatever signature the request carried', async () => {
  reset(); inserts.length = 0;
  const out = await run({ action: 'submit', token: as(11, 'worker'), record: record({ sign_later: true }) });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  const row = inserts[0];
  assert.equal(row.awaiting_signature, true);
  assert.equal(row.worker_signature, null, 'a smuggled signature image is dropped');
  assert.ok(row.signature_requested_at);
  assert.equal(row.submitted_by_roster_id, 11);
  assert.equal(row.worker_name, 'Crew Cam', 'the name is the roster name');
  assert.equal('sign_later' in row, false, 'the request flag is not a column');
});

test('an ordinary submit is unchanged: signed, not awaiting', async () => {
  reset(); inserts.length = 0;
  const out = await run({ action: 'submit', token: as(11, 'worker'), record: record() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(inserts[0].worker_signature, PNG);
  assert.notEqual(inserts[0].awaiting_signature, true);
});

test('sign_later needs an individual sign-in (a founder session has nobody to sign)', async () => {
  reset(); inserts.length = 0;
  const out = await run({ action: 'submit', token: mintToken({ role: 'supervisor', founder: true, companyId: 7 }), record: record({ sign_later: true }) });
  assert.equal(out.statusCode, 400);
  assert.equal(inserts.length, 0);
});

test('sign_later cannot ride an amendment', async () => {
  reset();
  const out = await run({ action: 'submit', token: as(11, 'worker'), amendingId: 201, record: record({ sign_later: true }) });
  assert.equal(out.statusCode, 400);
});

test('a database without the columns refuses sign_later and still takes an ordinary submit', async () => {
  reset(); inserts.length = 0; columnsExist = false;
  const later = await run({ action: 'submit', token: as(11, 'worker'), record: record({ sign_later: true }) });
  assert.equal(later.statusCode, 503);
  assert.equal(inserts.length, 0, 'nothing unsigned and unflagged is stored');
  const normal = await run({ action: 'submit', token: as(11, 'worker'), record: record() });
  assert.equal(normal.statusCode, 200, JSON.stringify(normal.body));
});

test('an unsigned FLHA cannot be approved: supervisor, lead or admin', async () => {
  reset();
  const sig = 'data:image/png;base64,AAAA';
  for (const token of [as(2, 'supervisor'), as(10, 'worker'), mintToken({ role: 'admin', founder: true })]) {
    const out = await run({ action: 'approve', token, id: 201, supName: 'Sup Sam', supSignature: sig });
    assert.equal(out.statusCode, 409, JSON.stringify(out.body));
  }
  assert.equal(FLHAS.find(f => f.id === 201).supervisor_signed_at, undefined);
  const signedOne = await run({ action: 'approve', token: as(2, 'supervisor'), id: 202, supName: 'Sup Sam', supSignature: sig });
  assert.equal(signedOne.statusCode, 200, 'a signed one is still approvable');
});

test('my_unsigned lists only the caller\'s own unsigned FLHAs', async () => {
  reset();
  const mine = await run({ action: 'my_unsigned', token: as(11, 'worker') });
  assert.equal(mine.statusCode, 200, JSON.stringify(mine.body));
  assert.deepEqual(mine.body.flhas.map(f => f.id), [201]);
  const other = await run({ action: 'my_unsigned', token: as(12, 'worker') });
  assert.deepEqual(other.body.flhas, []);
});

test('sign_now: only the author signs, once, and the signature is checked', async () => {
  reset();
  const wrongPerson = await run({ action: 'sign_now', token: as(12, 'worker'), id: 201, signature: PNG });
  assert.equal(wrongPerson.statusCode, 403);
  const aLead = await run({ action: 'sign_now', token: as(10, 'worker'), id: 201, signature: PNG });
  assert.equal(aLead.statusCode, 403, 'not even a crew lead signs for someone');
  const sup = await run({ action: 'sign_now', token: as(2, 'supervisor'), id: 201, signature: PNG });
  assert.equal(sup.statusCode, 403);
  const junk = await run({ action: 'sign_now', token: as(11, 'worker'), id: 201, signature: 'not a signature' });
  assert.equal(junk.statusCode, 400);
  assert.equal(FLHAS.find(f => f.id === 201).awaiting_signature, true, 'nothing changed yet');

  const ok = await run({ action: 'sign_now', token: as(11, 'worker'), id: 201, signature: PNG });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const row = FLHAS.find(f => f.id === 201);
  assert.equal(row.awaiting_signature, false);
  assert.equal(row.worker_signature, PNG);
  assert.ok(row.worker_signed_at);

  const again = await run({ action: 'sign_now', token: as(11, 'worker'), id: 201, signature: PNG });
  assert.equal(again.statusCode, 409, 'already signed');
  const notAwaiting = await run({ action: 'sign_now', token: as(11, 'worker'), id: 202, signature: PNG });
  assert.equal(notAwaiting.statusCode, 409);
});

test('once signed, the supervisor can approve it', async () => {
  reset();
  await run({ action: 'sign_now', token: as(11, 'worker'), id: 201, signature: PNG });
  const out = await run({ action: 'approve', token: as(2, 'supervisor'), id: 201, supName: 'Sup Sam', supSignature: 'data:image/png;base64,AAAA' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
});

test('an amendment cannot put a signature on an awaiting record, nor can a same-name colleague amend it', async () => {
  reset();
  FLHAS.push({ id: 203, company_id: 7, worker_name: 'Crew Cam', job_site: 'Pit', site_id: null, status: 'complete', submitted_by_roster_id: 11, created_at: new Date().toISOString(), hazards_json: { hazards: [{ risk: 'Low' }] }, pdf_url: null, worker_signature: null, awaiting_signature: true, signature_requested_at: new Date().toISOString() });
  const row = () => FLHAS.find(f => f.id === 203);
  const mine = await run({ action: 'submit', token: as(11, 'worker'), amendingId: 203, record: { job_site: 'Pit 2', worker_signature: PNG } });
  assert.equal(mine.statusCode, 200, JSON.stringify(mine.body));
  assert.equal(row().worker_signature, null, 'the amendment did not write a signature');
  assert.equal(row().awaiting_signature, true);
  ROSTER.push(P({ id: 99, name: 'Crew Cam', role: 'worker' }));
  const twin = await run({ action: 'submit', token: as(99, 'worker'), amendingId: 203, record: { job_site: 'Hijack' } });
  assert.equal(twin.statusCode, 403);
  ROSTER.pop();
});
