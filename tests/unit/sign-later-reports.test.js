// "Worker signs afterwards" for Incident and Near Miss, through the REAL
// api/reports.js handler behind a stand-in PostgREST:
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
  P({ id: 10, name: 'Lead Lee', role: 'worker', is_lead: true }),
  P({ id: 11, name: 'Crew Cam', role: 'worker', departments: ['safety'] }),
  P({ id: 12, name: 'Other Oz', role: 'worker' }),
];
const SETTINGS = ['incident', 'nearmiss'].map(k => ({ company_id: 7, document_key: k, is_active: true }));
let ROWS;
let columnsExist = true;
const baseRow = (over) => ({ company_id: 7, site: 'Pit', site_id: null, occurred_at: '2026-10-01T10:00:00Z', report_json: {}, pdf_url: null, signature_url: null, reviewed: false, created_at: '2026-10-01T10:00:00Z', ...over });
const reset = () => {
  columnsExist = true;
  ROWS = {
    incidents: [
      baseRow({ id: 201, reporter_name: 'Crew Cam', submitted_by_roster_id: 11, awaiting_signature: true, signature_requested_at: '2026-10-01T10:00:00Z' }),
      baseRow({ id: 202, reporter_name: 'Crew Cam', submitted_by_roster_id: 11, awaiting_signature: false, signature_url: 'https://x/storage/v1/object/public/signatures/7/a.png' }),
    ],
    near_misses: [
      baseRow({ id: 301, reporter_name: 'Crew Cam', is_anonymous: false, submitted_by_roster_id: 11, awaiting_signature: true, signature_requested_at: '2026-10-01T10:00:00Z' }),
    ],
  };
};
reset();
const inserts = { incidents: [], near_misses: [] };

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
    (eq('role') === null || r.role === eq('role')) &&
    (eq('submitted_by_roster_id') === null || String(r.submitted_by_roster_id) === eq('submitted_by_roster_id')) &&
    (eq('awaiting_signature') === null || String(r.awaiting_signature) === eq('awaiting_signature')));
  const select = url.searchParams.get('select') || '';
  const touchesSignColumns = /awaiting_signature|signature_requested_at|worker_signed_at/.test(select) || (payload && !Array.isArray(payload) && ('awaiting_signature' in payload || 'worker_signed_at' in payload));

  if (table === 'roster') return wantsObject ? send(200, filt(ROSTER)[0] || {}) : send(200, filt(ROSTER));
  if (table === 'company_document_settings') return send(200, filt(SETTINGS).filter(s => !eq('document_key') || s.document_key === eq('document_key')));
  if (table === 'incidents' || table === 'near_misses') {
    if (touchesSignColumns && !columnsExist) return send(400, { code: '42703', message: 'column "awaiting_signature" does not exist' });
    if (req.method === 'POST') {
      const row = { id: 900 + inserts[table].length, ...payload };
      inserts[table].push(row); ROWS[table].push(row);
      return wantsObject ? send(201, { id: row.id }) : send(201, [{ id: row.id }]);
    }
    if (req.method === 'PATCH') {
      const hit = filt(ROWS[table]);
      hit.forEach(r => Object.assign(r, payload));
      return send(200, hit.map(r => ({ id: r.id })));
    }
    if (req.method === 'DELETE') return send(200, []);
    return send(200, filt(ROWS[table]));
  }
  if (table === 'document_assignments') return send(200, []);
  if (table === 'audit_log') return send(201, []);
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: reports } = await import('../../api/reports.js');
const { signUploadReceipt } = await import('../../server-lib/uploadUrls.js');
test.after(() => new Promise(r => server.close(r)));

function fakeRes() {
  const out = { statusCode: null, body: null };
  return { out, status(c) { out.statusCode = c; return this; }, json(p) { out.body = p; return this; }, setHeader() {}, end() {} };
}
const run = async (body) => { const r = fakeRes(); await reports({ method: 'POST', body, headers: {}, socket: {} }, r); return r.out; };
const as = (userId, role) => mintToken({ role, userId, companyId: 7 });
const sigReceipt = () => signUploadReceipt('signatures', '7/sig.png', 7);
const pdfReceipt = () => signUploadReceipt('flha-reports', '7/signed.pdf', 7);
const incident = (extra = {}) => ({ reporter_name: 'Crew Cam', site: 'Pit', occurred_at: '2026-10-01T10:00:00Z', incident_type: 'Near hit', report_json: {}, signed_by: 'Crew Cam', ...extra });

test('incident submit with sign_later: stored unsigned and flagged, signature receipt ignored', async () => {
  reset();
  const out = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sigReceipt(), record: incident({ sign_later: true }) });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  const row = inserts.incidents[0];
  assert.equal(row.awaiting_signature, true);
  assert.equal(row.signature_url, null);
  assert.equal(row.submitted_by_roster_id, 11);
  assert.equal('sign_later' in row, false);
  assert.equal(out.body.awaitingSignature, true);
});

test('an ordinary signed incident submit is unchanged', async () => {
  reset(); inserts.incidents.length = 0;
  const out = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sigReceipt(), record: incident() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.ok(inserts.incidents[0].signature_url);
  assert.notEqual(inserts.incidents[0].awaiting_signature, true);
});

test('an incident with no signature at all is saved as sign-later, never as finished-and-unsigned', async () => {
  reset(); inserts.incidents.length = 0;
  const out = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), record: incident() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(inserts.incidents[0].awaiting_signature, true);
  const founder = await run({ type: 'incident', action: 'submit', token: mintToken({ role: 'supervisor', founder: true, companyId: 7 }), record: incident() });
  assert.equal(founder.statusCode, 400);
});

test('an anonymous near miss is never sign-later and takes no signature', async () => {
  reset(); inserts.near_misses.length = 0;
  const refused = await run({ type: 'nearmiss', action: 'submit', token: as(11, 'worker'), record: { reporter_name: 'x', is_anonymous: true, site: 'Pit', involved: 'x', report_json: {}, sign_later: true } });
  assert.equal(refused.statusCode, 400);
  const plain = await run({ type: 'nearmiss', action: 'submit', token: as(11, 'worker'), record: { reporter_name: 'x', is_anonymous: true, site: 'Pit', involved: 'x', report_json: {} } });
  assert.equal(plain.statusCode, 200, JSON.stringify(plain.body));
  assert.notEqual(inserts.near_misses[0].awaiting_signature, true);
  assert.equal(inserts.near_misses[0].submitted_by_roster_id, null, 'still anonymous');
});

test('a named near miss can be saved to sign afterwards, attributed to its author', async () => {
  reset(); inserts.near_misses.length = 0;
  const out = await run({ type: 'nearmiss', action: 'submit', token: as(11, 'worker'), record: { reporter_name: 'x', is_anonymous: false, site: 'Pit', involved: 'x', report_json: {}, sign_later: true } });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(inserts.near_misses[0].awaiting_signature, true);
  assert.equal(inserts.near_misses[0].submitted_by_roster_id, 11);
});

test('a database without the columns refuses sign_later', async () => {
  reset(); inserts.incidents.length = 0; columnsExist = false;
  const out = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sigReceipt(), record: incident({ sign_later: true }) });
  assert.equal(out.statusCode, 503);
  assert.equal(inserts.incidents.length, 0);
  const normal = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sigReceipt(), record: incident() });
  assert.equal(normal.statusCode, 200, JSON.stringify(normal.body));
});

test('an unsigned report cannot be marked reviewed, by anyone', async () => {
  reset();
  for (const [type, id] of [['incident', 201], ['nearmiss', 301]]) {
    for (const token of [as(2, 'supervisor'), mintToken({ role: 'admin', founder: true })]) {
      const out = await run({ type, action: 'review', token, id, notes: 'ok' });
      assert.equal(out.statusCode, 409, `${type} ${JSON.stringify(out.body)}`);
    }
  }
  const signed = await run({ type: 'incident', action: 'review', token: as(2, 'supervisor'), id: 202, notes: 'ok' });
  assert.equal(signed.statusCode, 200, JSON.stringify(signed.body));
});

test('my_unsigned lists only the caller\'s own unsigned reports', async () => {
  reset();
  const mine = await run({ type: 'incident', action: 'my_unsigned', token: as(11, 'worker') });
  assert.equal(mine.statusCode, 200, JSON.stringify(mine.body));
  assert.deepEqual(mine.body.records.map(r => r.id), [201]);
  const other = await run({ type: 'incident', action: 'my_unsigned', token: as(12, 'worker') });
  assert.deepEqual(other.body.records, []);
});

test('sign_now: only the author, once, with both uploads', async () => {
  reset();
  const base = { type: 'incident', action: 'sign_now', id: 201, signatureReceipt: sigReceipt(), pdfUrl: pdfReceipt() };
  for (const who of [as(12, 'worker'), as(10, 'worker'), as(2, 'supervisor')]) {
    assert.equal((await run({ ...base, token: who })).statusCode, 403);
  }
  assert.equal((await run({ ...base, token: as(11, 'worker'), signatureReceipt: undefined })).statusCode, 400);
  assert.equal((await run({ ...base, token: as(11, 'worker'), pdfUrl: undefined })).statusCode, 400);
  assert.equal(ROWS.incidents.find(r => r.id === 201).awaiting_signature, true, 'nothing changed yet');

  const ok = await run({ ...base, token: as(11, 'worker') });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const row = ROWS.incidents.find(r => r.id === 201);
  assert.equal(row.awaiting_signature, false);
  assert.ok(row.signature_url);
  assert.ok(row.worker_signed_at);
  assert.equal((await run({ ...base, token: as(11, 'worker') })).statusCode, 409, 'already signed');

  const once = await run({ type: 'incident', action: 'review', token: as(2, 'supervisor'), id: 201, notes: 'ok' });
  assert.equal(once.statusCode, 200, 'reviewable once signed');
});

test('a near miss is signed the same way', async () => {
  reset();
  const ok = await run({ type: 'nearmiss', action: 'sign_now', token: as(11, 'worker'), id: 301, signatureReceipt: sigReceipt(), pdfUrl: pdfReceipt() });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(ROWS.near_misses[0].awaiting_signature, false);
  const wrong = await run({ type: 'nearmiss', action: 'sign_now', token: as(12, 'worker'), id: 301, signatureReceipt: sigReceipt(), pdfUrl: pdfReceipt() });
  assert.equal(wrong.statusCode, 403);
});
