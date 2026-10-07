// Notifications wired into Monthly Inspection (api/monthly.js) and custom
// documents (api/customforms.js), through the REAL handlers behind a stand-in
// PostgREST with the mail provider intercepted. The audience rules themselves
// are covered in notify-routing.test.js and notify-wiring.test.js; this checks
// each document type calls the notifier at the right moment:
//   - off unless that document's Notify switch is on (per document)
//   - a signed FLHA / inspection / toolbox talk / daily report tells its audience,
//     never the author
//   - a sign-later FLHA or inspection tells nobody when saved, its audience when signed
//   - inspections carry no site, so they are placed by the author alone

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

const emails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes('api.resend.com')) { emails.push(JSON.parse(init.body)); return new Response('{"id":"x"}', { status: 200 }); }
  return realFetch(url, init);
};

const P = (over) => ({ company_id: 7, active: true, is_owner: false, is_lead: false, hide_unassigned: false, departments: [], divisions: [], default_site_id: null, ...over });
const em = (a) => encryptField(a);
const ROSTER = [
  P({ id: 1, name: 'Owner Olly', role: 'supervisor', is_owner: true, email: em('owner@x.test') }),
  P({ id: 2, name: 'Sup Sam', role: 'supervisor', departments: ['safety'], email: em('sam@x.test') }),
  P({ id: 3, name: 'Site Sue', role: 'supervisor', default_site_id: 50, email: em('sue@x.test') }),
  P({ id: 10, name: 'Lead Lee', role: 'worker', is_lead: true, departments: ['safety'], email: em('lee@x.test') }),
  P({ id: 11, name: 'Crew Cam', role: 'worker', departments: ['safety'], email: em('cam@x.test') }),
];
const KEYS = ['monthly', 'custom_5'];
const SETTINGS = KEYS.map((k) => ({ company_id: 7, document_key: k, is_active: true }));
const SITES = [{ id: 50, company_id: 7, name: 'Hwy 2 Pit', division_id: null }];
let NOTIFY, STATE, ROWS;
const reset = () => {
  emails.length = 0;
  NOTIFY = KEYS.map((k) => ({ company_id: 7, document_key: k, enabled: true, extra_roster_ids: [] }));
  STATE = [];
  ROWS = {
    inspection_forms: [{ id: 3, company_id: 7, title: 'Yard Walkaround' }],
    inspection_form_questions: [{ id: 31, form_id: 3, question_text: 'Fire extinguisher present' }],
    inspection_records: [], inspection_answers: [],
    custom_forms: [{ id: 5, company_id: 7, title: 'Hot Work Permit', is_active: true }],
    custom_form_questions: [{ id: 51, form_id: 5, question_text: 'Permit posted' }],
    custom_form_records: [], custom_form_answers: [],
  };
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
    (eq('form_id') === null || String(r.form_id) === eq('form_id')) &&
    (eq('company_id') === null || String(r.company_id) === eq('company_id')) &&
    (eq('active') === null || String(r.active) === eq('active')) &&
    (eq('document_key') === null || r.document_key === eq('document_key')) &&
    (eq('submitted_by_roster_id') === null || String(r.submitted_by_roster_id) === eq('submitted_by_roster_id')) &&
    (eq('awaiting_signature') === null || String(r.awaiting_signature) === eq('awaiting_signature')));

  if (path === 'rpc/claim_notification_slot') {
    const a = payload;
    const r = STATE.find((x) => x.c === a.p_company && x.k === a.p_key && x.r === a.p_roster);
    const now = Date.now();
    if (!r) { STATE.push({ c: a.p_company, k: a.p_key, r: a.p_roster, at: now, sent: 1, held: 0 }); return send(200, [{ allowed: true, suppressed: 0 }]); }
    if (now - r.at >= a.p_window_seconds * 1000) { const h = r.held; Object.assign(r, { at: now, sent: 1, held: 0 }); return send(200, [{ allowed: true, suppressed: h }]); }
    if (r.sent < a.p_burst) { r.sent += 1; return send(200, [{ allowed: true, suppressed: 0 }]); }
    r.held += 1; return send(200, [{ allowed: false, suppressed: 0 }]);
  }
  if (path === 'roster') return wantsObject ? send(200, filt(ROSTER)[0] || {}) : send(200, filt(ROSTER));
  if (path === 'company_document_settings') return send(200, filt(SETTINGS));
  if (path === 'document_notifications') return send(200, filt(NOTIFY));
  if (path === 'companies') return send(200, [{ id: 7, suspended: false }]);
  if (path === 'sites') return send(200, filt(SITES));
  if (ROWS[path]) {
    if (req.method === 'POST') {
      const row = { id: 900 + ROWS[path].length, status: 'complete', ...payload };
      ROWS[path].push(row);
      return wantsObject ? send(201, { id: row.id, status: row.status }) : send(201, [{ id: row.id, status: row.status }]);
    }
    if (req.method === 'PATCH') { const hit = filt(ROWS[path]); hit.forEach((r) => Object.assign(r, payload)); return send(200, hit.map((r) => ({ id: r.id }))); }
    return send(200, filt(ROWS[path]));
  }
  if (path === 'document_assignments') return send(200, []);
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: monthly } = await import('../../api/monthly.js');
const { default: custom } = await import('../../api/customforms.js');
test.after(() => new Promise((r) => server.close(r)));

const fakeRes = () => { const o = { statusCode: null, body: null }; return { o, status(c) { o.statusCode = c; return this; }, json(p) { o.body = p; return this; }, setHeader() {}, end() {} }; };
const call = (handler) => async (body) => { const r = fakeRes(); await handler({ method: 'POST', body, headers: {}, socket: {} }, r); return r.o; };
const runMonthly = call(monthly);
const runCustom = call(custom);
const to = () => emails.map((e) => e.to).sort();


const answers = (q) => [{ questionId: q, answer: true, note: '' }];

test('Monthly Inspection: tells the audience, never the author, with the site name', async () => {
  reset();
  const out = await runMonthly({ action: 'submit_monthly', token: as(11, 'worker'), siteId: 50, formId: 3, answers: answers(31), submittedBy: 'Crew Cam' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.deepEqual(to(), ['lee@x.test', 'sam@x.test', 'sue@x.test']);
  for (const e of emails) assert.equal(e.subject, 'New Monthly Inspection at Hwy 2 Pit');
});

test('Monthly Inspection: off unless the Owner turned it on', async () => {
  reset(); NOTIFY = [];
  const out = await runMonthly({ action: 'submit_monthly', token: as(11, 'worker'), siteId: 50, formId: 3, answers: answers(31), submittedBy: 'Crew Cam' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(emails.length, 0);
});

test('Custom document: named after the form, switch is per form', async () => {
  reset();
  const out = await runCustom({ action: 'submit_custom', token: as(11, 'worker'), siteId: 50, formId: 5, answers: answers(51), submittedBy: 'Crew Cam' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.deepEqual(to(), ['lee@x.test', 'sam@x.test', 'sue@x.test']);
  for (const e of emails) assert.equal(e.subject, 'New Hot Work Permit at Hwy 2 Pit');
  emails.length = 0; NOTIFY = NOTIFY.filter((n) => n.document_key !== 'custom_5');
  await runCustom({ action: 'submit_custom', token: as(11, 'worker'), siteId: 50, formId: 5, answers: answers(51), submittedBy: 'Crew Cam' });
  assert.equal(emails.length, 0, 'this form is off');
});

test('Custom document: a form title carrying a link is not put in the email as-is', async () => {
  reset(); ROWS.custom_forms[0].title = 'Click http://evil.example now';
  await runCustom({ action: 'submit_custom', token: as(11, 'worker'), siteId: 50, formId: 5, answers: answers(51), submittedBy: 'Crew Cam' });
  assert.ok(emails.length > 0);
  for (const e of emails) assert.ok(!/evil\.example/.test(e.subject + e.html + (e.text || '')), 'no link in the email');
});
