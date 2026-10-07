// "Worker signs afterwards" for Equipment Inspection, through the REAL
// api/logs.js handler behind a stand-in PostgREST, plus the rule that an
// unsigned inspection's readings count toward nothing.

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
const SETTINGS = ['inspection', 'fuellog'].map(k => ({ company_id: 7, document_key: k, is_active: true }));
let ROWS;
let columnsExist = true;
const insp = (over) => ({ company_id: 7, worker_name: 'Crew Cam', equipment_label: 'Cat 320', trip_type: 'pretrip', start_reading: 100, end_reading: null, reading_unit: 'hrs', results_json: {}, pdf_url: null, signed_by: 'Crew Cam', created_at: '2026-10-01T10:00:00Z', linked_inspection_id: null, submitted_by_roster_id: 11, awaiting_signature: false, ...over });
const reset = () => {
  columnsExist = true;
  ROWS = {
    inspections: [
      insp({ id: 201, start_reading: 150, awaiting_signature: true, signature_requested_at: '2026-10-02T10:00:00Z', created_at: '2026-10-02T10:00:00Z' }),
      insp({ id: 202, start_reading: 120, created_at: '2026-10-01T10:00:00Z' }),
    ],
    fuel_logs: [],
  };
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
  const inList = (k) => { const v = url.searchParams.get(k); return v && v.startsWith('in.(') ? v.slice(4, -1).split(',') : null; };
  const filt = (list) => list.filter(r =>
    (eq('id') === null || String(r.id) === eq('id')) &&
    (eq('company_id') === null || String(r.company_id) === eq('company_id')) &&
    (eq('active') === null || String(r.active) === eq('active')) &&
    (eq('role') === null || r.role === eq('role')) &&
    (eq('equipment_label') === null || r.equipment_label === eq('equipment_label')) &&
    (eq('submitted_by_roster_id') === null || String(r.submitted_by_roster_id) === eq('submitted_by_roster_id')) &&
    (eq('awaiting_signature') === null || String(r.awaiting_signature === true) === eq('awaiting_signature')) &&
    (inList('id') === null || inList('id').includes(String(r.id))));
  const select = url.searchParams.get('select') || '';
  const touchesSignColumns = /awaiting_signature|signature_requested_at|worker_signed_at/.test(select) || url.searchParams.has('awaiting_signature') || (payload && !Array.isArray(payload) && ('awaiting_signature' in payload || 'worker_signed_at' in payload));

  if (table === 'roster') return wantsObject ? send(200, filt(ROSTER)[0] || {}) : send(200, filt(ROSTER));
  if (table === 'company_document_settings') return send(200, filt(SETTINGS).filter(s => !eq('document_key') || s.document_key === eq('document_key')));
  if (table === 'inspections') {
    if (touchesSignColumns && !columnsExist) return send(400, { code: '42703', message: 'column "awaiting_signature" does not exist' });
    if (req.method === 'POST') {
      const row = { id: 900 + inserts.length, ...payload };
      inserts.push(row); ROWS.inspections.push(row);
      return wantsObject ? send(201, { id: row.id }) : send(201, [{ id: row.id }]);
    }
    if (req.method === 'PATCH') {
      const hit = filt(ROWS.inspections);
      hit.forEach(r => Object.assign(r, payload));
      return send(200, hit.map(r => ({ id: r.id })));
    }
    if (req.method === 'DELETE') return send(200, []);
    return send(200, filt(ROWS.inspections));
  }
  if (table === 'fuel_logs') return send(200, []);
  if (table === 'document_assignments') return send(200, []);
  if (table === 'audit_log') return send(201, []);
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: logs } = await import('../../api/logs.js');
const { default: fuellogs } = await import('../../api/fuellogs.js');
const { signUploadReceipt } = await import('../../server-lib/uploadUrls.js');
test.after(() => new Promise(r => server.close(r)));

function fakeRes() {
  const out = { statusCode: null, body: null };
  return { out, status(c) { out.statusCode = c; return this; }, json(p) { out.body = p; return this; }, setHeader() {}, end() {} };
}
const run = async (handler, body) => { const r = fakeRes(); await handler({ method: 'POST', body, headers: {}, socket: {} }, r); return r.out; };
const as = (userId, role) => mintToken({ role, userId, companyId: 7 });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const pdfReceipt = () => signUploadReceipt('flha-reports', '7/signed-inspection.pdf', 7);
const record = (extra = {}) => ({ worker_name: 'Crew Cam', equipment_label: 'Cat 320', results_json: {}, signed_by: 'Crew Cam', trip_type: 'pretrip', start_reading: 160, reading_unit: 'hrs', ...extra });

test('inspection submit with sign_later: stored unsigned and flagged, author from the session', async () => {
  reset(); inserts.length = 0;
  const out = await run(logs, { type: 'inspection', action: 'submit', token: as(11, 'worker'), record: record({ sign_later: true }) });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(inserts[0].awaiting_signature, true);
  assert.equal(inserts[0].submitted_by_roster_id, 11);
  assert.equal('sign_later' in inserts[0], false);
  assert.equal(out.body.awaitingSignature, true);
});

test('an ordinary inspection submit is unchanged', async () => {
  reset(); inserts.length = 0;
  const out = await run(logs, { type: 'inspection', action: 'submit', token: as(11, 'worker'), record: record() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.notEqual(inserts[0].awaiting_signature, true);
});

test('sign_later needs an individual sign-in, and a database without the columns refuses it', async () => {
  reset(); inserts.length = 0;
  const founder = await run(logs, { type: 'inspection', action: 'submit', token: mintToken({ role: 'supervisor', founder: true, companyId: 7 }), record: record({ sign_later: true }) });
  assert.equal(founder.statusCode, 400);
  columnsExist = false;
  const later = await run(logs, { type: 'inspection', action: 'submit', token: as(11, 'worker'), record: record({ sign_later: true }) });
  assert.equal(later.statusCode, 503);
  assert.equal(inserts.length, 0);
  const normal = await run(logs, { type: 'inspection', action: 'submit', token: as(11, 'worker'), record: record() });
  assert.equal(normal.statusCode, 200, JSON.stringify(normal.body));
});

test('my_unsigned lists only the caller\'s own', async () => {
  reset();
  const mine = await run(logs, { type: 'inspection', action: 'my_unsigned', token: as(11, 'worker') });
  assert.equal(mine.statusCode, 200, JSON.stringify(mine.body));
  assert.deepEqual(mine.body.records.map(r => r.id), [201]);
  assert.deepEqual((await run(logs, { type: 'inspection', action: 'my_unsigned', token: as(12, 'worker') })).body.records, []);
  assert.equal((await run(logs, { type: 'toolbox', action: 'my_unsigned', token: as(11, 'worker') })).statusCode, 400);
});

test('sign_now: only the author, once, with the signed PDF uploaded', async () => {
  reset();
  const base = { type: 'inspection', action: 'sign_now', id: 201, signature: PNG, pdfUrl: pdfReceipt() };
  for (const who of [as(12, 'worker'), as(10, 'worker'), as(2, 'supervisor')]) {
    assert.equal((await run(logs, { ...base, token: who })).statusCode, 403);
  }
  assert.equal((await run(logs, { ...base, token: as(11, 'worker'), signature: 'nope' })).statusCode, 400);
  assert.equal((await run(logs, { ...base, token: as(11, 'worker'), pdfUrl: undefined })).statusCode, 400);
  assert.equal(ROWS.inspections.find(r => r.id === 201).awaiting_signature, true, 'nothing changed yet');
  const ok = await run(logs, { ...base, token: as(11, 'worker') });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const row = ROWS.inspections.find(r => r.id === 201);
  assert.equal(row.awaiting_signature, false);
  assert.ok(row.worker_signed_at);
  assert.equal((await run(logs, { ...base, token: as(11, 'worker') })).statusCode, 409);
});

test('an unsigned inspection is not edited under its author', async () => {
  reset();
  const blocked = await run(logs, { type: 'inspection', action: 'update', token: as(2, 'supervisor'), id: 201, fields: { start_reading: 1 } });
  assert.equal(blocked.statusCode, 409, JSON.stringify(blocked.body));
  const signedEdit = await run(logs, { type: 'inspection', action: 'update', token: as(2, 'supervisor'), id: 202, fields: { start_reading: 125 } });
  assert.notEqual(signedEdit.statusCode, 409, JSON.stringify(signedEdit.body));
});

test('an unsigned inspection\'s reading does not count: the last-reading lookup skips it', async () => {
  reset();
  const out = await run(fuellogs, { action: 'check_equipment', token: as(11, 'worker'), equipmentLabel: 'Cat 320' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  const seen = JSON.stringify(out.body);
  assert.ok(seen.includes('120'), 'the signed reading is used');
  assert.ok(!seen.includes('150'), 'the unsigned reading is not');
  ROWS.inspections.find(r => r.id === 201).awaiting_signature = false;
  const signed = await run(fuellogs, { action: 'check_equipment', token: as(11, 'worker'), equipmentLabel: 'Cat 320' });
  assert.ok(JSON.stringify(signed.body).includes('150'), 'once signed it counts');
});
