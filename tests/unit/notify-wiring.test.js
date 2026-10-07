// Notifications wired into Incident and Near Miss (api/reports.js), through the
// REAL handler behind a stand-in PostgREST, with the mail provider intercepted:
//   - off by default: no setting, no email
//   - a signed submit tells the people who could open it, never the author
//   - a sign-later report tells nobody when saved, and tells its audience when signed
//   - an anonymous near miss is routed by site alone and names no person
//   - the site name in the email comes from the sites table, not from what was typed
//   - a replayed submit does not notify twice
//   - a failing mail provider never fails the submit
//   - without the mail key nothing is claimed or sent

process.env.SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.FIELD_ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.RESEND_API_KEY = 're_test_key';

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { encryptField } from '../../server-lib/fieldCrypto.js';

const mintToken = (payload) => {
  const data = Buffer.from(JSON.stringify({ issuedAt: Date.now(), founder: false, ...payload })).toString('base64url');
  return `${data}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(data).digest('base64url')}`;
};
const as = (userId, role) => mintToken({ role, userId, companyId: 7 });

// ── mail provider interception ──────────────────────────────────────────
const emails = [];
const resendInits = [];
let COMPANY_SUSPENDED = false;
let resendStatus = 200;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.resend.com')) {
    if (resendStatus !== 200) return new Response('{"message":"down"}', { status: resendStatus });
    emails.push(JSON.parse(init.body));
    resendInits.push(init);
    return new Response('{"id":"x"}', { status: 200 });
  }
  return realFetch(url, init);
};

// ── stand-in database ───────────────────────────────────────────────────
const P = (over) => ({ company_id: 7, active: true, is_owner: false, is_lead: false, hide_unassigned: false, departments: [], divisions: [], default_site_id: null, ...over });
const em = (a) => encryptField(a);
const ROSTER = [
  P({ id: 1, name: 'Owner Olly', role: 'supervisor', is_owner: true, email: em('owner@x.test') }),
  P({ id: 2, name: 'Sup Sam', role: 'supervisor', departments: ['safety'], email: em('sam@x.test') }),
  P({ id: 3, name: 'Site Sue', role: 'supervisor', default_site_id: 50, email: em('sue@x.test') }),
  P({ id: 10, name: 'Lead Lee', role: 'worker', is_lead: true, departments: ['safety'], email: em('lee@x.test') }),
  P({ id: 11, name: 'Crew Cam', role: 'worker', departments: ['safety'], email: em('cam@x.test') }),
  P({ id: 12, name: 'Other Oz', role: 'worker', departments: ['yard'], email: em('oz@x.test') }),
];
const SETTINGS = ['incident', 'nearmiss'].map((k) => ({ company_id: 7, document_key: k, is_active: true }));
const SITES = [{ id: 50, company_id: 7, name: 'Hwy 2 Pit', division_id: null }, { id: 52, company_id: 7, name: 'URGENT alert evil.example/verify', division_id: null }, { id: 51, company_id: 8, name: 'Other Co Yard', division_id: null }];
let NOTIFY, STATE, ROWS;
const reset = () => {
  emails.length = 0; resendInits.length = 0; resendStatus = 200; COMPANY_SUSPENDED = false;
  NOTIFY = [{ company_id: 7, document_key: 'incident', enabled: true, extra_roster_ids: [] }, { company_id: 7, document_key: 'nearmiss', enabled: true, extra_roster_ids: [] }];
  STATE = [];
  ROWS = { incidents: [], near_misses: [] };
};
reset();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace('/rest/v1/', '');
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => r(b)); });
  const payload = body ? JSON.parse(body) : null;
  const wantsObject = (req.headers.accept || '').includes('pgrst.object');
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const eq = (k) => { const v = url.searchParams.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  const filt = (list) => list.filter((r) =>
    (eq('id') === null || String(r.id) === eq('id')) &&
    (eq('company_id') === null || String(r.company_id) === eq('company_id')) &&
    (eq('active') === null || String(r.active) === eq('active')) &&
    (eq('document_key') === null || r.document_key === eq('document_key')) &&
    (eq('submitted_by_roster_id') === null || String(r.submitted_by_roster_id) === eq('submitted_by_roster_id')) &&
    (eq('awaiting_signature') === null || String(r.awaiting_signature) === eq('awaiting_signature')));

  if (path === 'rpc/claim_notification_slot') {
    const a = payload;
    let r = STATE.find((x) => x.c === a.p_company && x.k === a.p_key && x.r === a.p_roster);
    const now = Date.now();
    if (!r) { STATE.push({ c: a.p_company, k: a.p_key, r: a.p_roster, at: now, sent: 1, held: 0 }); return send(200, [{ allowed: true, suppressed: 0 }]); }
    if (now - r.at >= a.p_window_seconds * 1000) { const h = r.held; Object.assign(r, { at: now, sent: 1, held: 0 }); return send(200, [{ allowed: true, suppressed: h }]); }
    if (r.sent < a.p_burst) { r.sent += 1; return send(200, [{ allowed: true, suppressed: 0 }]); }
    r.held += 1; return send(200, [{ allowed: false, suppressed: 0 }]);
  }
  if (path === 'rpc/refund_notification_slot') return send(200, null);
  if (path === 'roster') return wantsObject ? send(200, filt(ROSTER)[0] || {}) : send(200, filt(ROSTER));
  if (path === 'company_document_settings') return send(200, filt(SETTINGS));
  if (path === 'document_notifications') return send(200, filt(NOTIFY));
  if (path === 'companies') return send(200, [{ id: 7, suspended: COMPANY_SUSPENDED }]);
  if (path === 'sites') return send(200, filt(SITES));
  if (path === 'incidents' || path === 'near_misses') {
    if (req.method === 'POST') {
      const row = { id: 900 + ROWS[path].length, ...payload };
      ROWS[path].push(row);
      return wantsObject ? send(201, { id: row.id }) : send(201, [{ id: row.id }]);
    }
    if (req.method === 'PATCH') { const hit = filt(ROWS[path]); hit.forEach((r) => Object.assign(r, payload)); return send(200, hit.map((r) => ({ id: r.id }))); }
    return send(200, filt(ROWS[path]));
  }
  if (path === 'document_assignments') return send(200, []);
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: reports } = await import('../../api/reports.js');
const { signUploadReceipt } = await import('../../server-lib/uploadUrls.js');
test.after(() => new Promise((r) => server.close(r)));

const fakeRes = () => { const o = { statusCode: null, body: null }; return { o, status(c) { o.statusCode = c; return this; }, json(p) { o.body = p; return this; }, setHeader() {}, end() {} }; };
const run = async (body) => { const r = fakeRes(); await reports({ method: 'POST', body, headers: {}, socket: {} }, r); return r.o; };
const sig = () => signUploadReceipt('signatures', '7/sig.png', 7);
const pdf = () => signUploadReceipt('flha-reports', '7/signed.pdf', 7);
const incident = (extra = {}) => ({ reporter_name: 'Crew Cam', site: 'Hwy 2 Pit', site_id: 50, occurred_at: '2026-10-01T10:00:00Z', incident_type: 'Near hit', report_json: { summary: 'SECRET DETAIL' }, signed_by: 'Crew Cam', ...extra });
const nearmiss = (extra = {}) => ({ reporter_name: 'Crew Cam', is_anonymous: false, site: 'Hwy 2 Pit', site_id: 50, occurred_at: '2026-10-01T10:00:00Z', involved: 'Loader', report_json: { whatHappened: 'SECRET DETAIL' }, signed_by: 'Crew Cam', ...extra });
const to = () => emails.map((e) => e.to).sort();

test('off by default: with no Notify setting nothing is emailed', async () => {
  reset(); NOTIFY.length = 0;
  const out = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sig(), record: incident() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(emails.length, 0);
});

test('a signed incident tells the people who could open it, never the author, and no content', async () => {
  reset();
  const out = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sig(), record: incident() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.deepEqual(to(), ['lee@x.test', 'sam@x.test', 'sue@x.test'], 'safety supervisor, site supervisor, safety lead; not the author, not the Owner');
  for (const e of emails) {
    assert.equal(e.subject, 'New Incident Report at Hwy 2 Pit');
    assert.ok(!JSON.stringify(e).includes('SECRET DETAIL'));
    assert.ok(!JSON.stringify(e).includes('Crew Cam'));
    assert.equal(typeof e.to, 'string');
  }
});

test('a sign-later incident tells nobody when saved, and its audience when signed', async () => {
  reset();
  const saved = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), record: incident({ sign_later: true }) });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.awaitingSignature, true);
  assert.equal(emails.length, 0, 'nothing while unsigned');
  const id = saved.body.id;
  const signed = await run({ type: 'incident', action: 'sign_now', token: as(11, 'worker'), id, signatureReceipt: sig(), pdfUrl: pdf() });
  assert.equal(signed.statusCode, 200, JSON.stringify(signed.body));
  assert.deepEqual(to(), ['lee@x.test', 'sam@x.test', 'sue@x.test']);
  assert.equal(emails[0].subject, 'New Incident Report at Hwy 2 Pit');
});

test('an anonymous near miss is routed by site alone and names no one', async () => {
  reset();
  const out = await run({ type: 'nearmiss', action: 'submit', token: as(11, 'worker'), record: nearmiss({ is_anonymous: true, reporter_name: 'Anonymous' }) });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.deepEqual(to(), ['sue@x.test'], 'only the supervisor at that site; the author\'s safety department and lead are not used');
  assert.ok(!JSON.stringify(emails).includes('Crew Cam'));
  assert.equal(emails[0].subject, 'New Near Miss Report at Hwy 2 Pit');
});

test('a named near miss reaches the author\'s department and crew lead', async () => {
  reset();
  const out = await run({ type: 'nearmiss', action: 'submit', token: as(11, 'worker'), signatureReceipt: sig(), record: nearmiss() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.deepEqual(to(), ['lee@x.test', 'sam@x.test', 'sue@x.test']);
});

test('the site name comes from the sites table, not from what the worker typed', async () => {
  reset();
  await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sig(), record: incident({ site: 'Log in at https://evil.example now' }) });
  assert.ok(emails.length > 0);
  for (const e of emails) {
    assert.equal(e.subject, 'New Incident Report at Hwy 2 Pit');
    assert.ok(!JSON.stringify(e).includes('evil'));
  }
});

test('a site from another company is refused before anything is emailed', async () => {
  reset();
  const out = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sig(), record: incident({ site_id: 51 }) });
  assert.equal(out.statusCode, 403);
  assert.equal(emails.length, 0);
});

test('a replayed submit does not notify twice', async () => {
  reset();
  const body = { type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sig(), clientSubmissionId: 'abc-123', record: incident() };
  // the replay lookup reads report_json->client_submission_id; give the stub that row after the first insert
  const first = await run(body);
  assert.equal(first.statusCode, 200);
  const sent = emails.length;
  assert.ok(sent > 0);
  ROWS.incidents[0]['report_json->>client_submission_id'] = 'abc-123';
  const again = await run(body);
  assert.equal(again.statusCode, 200);
  assert.equal(emails.length, sent, 'no second round of email');
});

test('a failing mail provider never fails the submit', async () => {
  reset(); resendStatus = 500;
  const out = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sig(), record: incident() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(ROWS.incidents.length, 1, 'the report is saved');
});

test('without the mail key nothing is claimed or sent', async () => {
  reset();
  const prev = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const out = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sig(), record: incident() });
  process.env.RESEND_API_KEY = prev;
  assert.equal(out.statusCode, 200);
  assert.equal(emails.length, 0);
  assert.equal(STATE.length, 0, 'no email slot was spent');
});

test('the burst limit holds across repeated submits', async () => {
  reset();
  for (let i = 0; i < 6; i += 1) await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sig(), record: incident() });
  assert.equal(emails.length, 3 * 3, 'three people, three emails each, then held');
  assert.ok(STATE.every((r) => r.held === 3));
});

test('a site named by a worker with link or phishing text never reaches an email', async () => {
  reset();
  const out = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sig(), record: incident({ site_id: 52, site: 'x' }) });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.ok(emails.length > 0);
  for (const e of emails) {
    assert.equal(e.subject, 'New Incident Report');
    assert.ok(!/evil|URGENT/.test(JSON.stringify(e)));
  }
});

test('every send to the mail provider carries a timeout', async () => {
  reset();
  await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), signatureReceipt: sig(), record: incident() });
  assert.ok(resendInits.length > 0);
  for (const init of resendInits) assert.ok(init.signal instanceof AbortSignal, 'a stalled provider cannot hold a submit open');
});

test('signing a saved report after the company is suspended notifies nobody', async () => {
  reset();
  const saved = await run({ type: 'incident', action: 'submit', token: as(11, 'worker'), record: incident({ sign_later: true }) });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  COMPANY_SUSPENDED = true;
  const signed = await run({ type: 'incident', action: 'sign_now', token: as(11, 'worker'), id: saved.body.id, signatureReceipt: sig(), pdfUrl: pdf() });
  assert.equal(signed.statusCode, 200, JSON.stringify(signed.body));
  assert.equal(emails.length, 0);
});
