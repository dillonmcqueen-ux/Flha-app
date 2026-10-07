// Corrective actions follow the record they were raised on (break #48), through the
// REAL handler (api/monthly.js) behind a stand-in PostgREST:
//   - list: a supervisor sees an action only if they could open its source record
//     (the document's view rows, then site and author); the Owner sees all
//   - an action whose source record is gone is placed by nothing, so only the Owner sees it
//   - update: a supervisor cannot change an action raised on a record they cannot open,
//     with the same generic 403 as another company's action
//   - another company's actions never appear

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
  P(1, 7, 'Owner Olly', 'supervisor', { is_owner: true }),
  P(2, 7, 'Sue Site50', 'supervisor', { departments: ['safety'], default_site_id: 50 }),
  P(3, 7, 'Sam Site70', 'supervisor', { departments: ['safety'], default_site_id: 70 }),
  P(11, 7, 'Writer Wes', 'worker', { departments: ['crew'] }),
  P(12, 7, 'Writer Wendy', 'worker', { departments: ['safety'] }),
  P(90, 8, 'Other Sup', 'supervisor', { default_site_id: 50 }),
];
const ACTIONS = [
  { id: 1, company_id: 7, source_type: 'incident', source_id: 100, status: 'open', created_at: '2026-10-01T00:00:00Z' },
  { id: 2, company_id: 7, source_type: 'incident', source_id: 101, status: 'open', created_at: '2026-10-02T00:00:00Z' },
  { id: 3, company_id: 7, source_type: 'monthly_answer', source_id: 300, status: 'open', created_at: '2026-10-03T00:00:00Z' },
  { id: 4, company_id: 7, source_type: 'equipment_inspection', source_id: 400, status: 'open', created_at: '2026-10-04T00:00:00Z' },
  { id: 5, company_id: 7, source_type: 'incident', source_id: 999, status: 'open', created_at: '2026-10-05T00:00:00Z' },
  { id: 6, company_id: 8, source_type: 'incident', source_id: 800, status: 'open', created_at: '2026-10-06T00:00:00Z' },
];
const INCIDENTS = [
  { id: 100, company_id: 7, site: 'Pit', site_id: 50, submitted_by_roster_id: 11, occurred_at: null, reporter_name: 'Wes', incident_type: 'Injury', awaiting_signature: false },
  { id: 101, company_id: 7, site: 'Yard', site_id: 60, submitted_by_roster_id: 11, occurred_at: null, reporter_name: 'Wes', incident_type: 'Spill', awaiting_signature: false },
  { id: 800, company_id: 8, site: 'Other', site_id: 50, submitted_by_roster_id: 90, occurred_at: null, reporter_name: 'X', incident_type: 'Fall', awaiting_signature: false },
];
const INSPECTIONS = [{ id: 400, company_id: 7, equipment_label: 'Cat 320', worker_name: 'Wendy', trip_type: 'pretrip', created_at: '2026-10-04T00:00:00Z', submitted_by_roster_id: 12, awaiting_signature: false }];
const ANSWERS = [{ id: 300, record_id: 30, question_id: 3 }];
const RECORDS = [{ id: 30, form_id: 5, site_id: 60, period_month: '2026-10-01', submitted_by: 'Wes', submitted_by_roster_id: 11 }];
const FORMS = [{ id: 5, company_id: 7 }];
const SITES = [50, 60, 70].map((id) => ({ id, company_id: 7, name: `Site ${id}`, division_id: null }));
let updated = [];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => r(b)); });
  const payload = body ? JSON.parse(body) : null;
  const wantsObject = (req.headers.accept || '').includes('pgrst.object');
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const rows = (list) => (wantsObject ? send(200, list[0] || {}) : send(200, list));
  const filt = (list) => list.filter((r) => {
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      if (v.startsWith('eq.') && String(r[k]) !== v.slice(3)) return false;
      if (v.startsWith('in.') && !v.slice(4, -1).split(',').includes(String(r[k]))) return false;
    }
    return true;
  });
  const tables = { roster: ROSTER, incidents: INCIDENTS, near_misses: [], inspections: INSPECTIONS, inspection_answers: ANSWERS, inspection_records: RECORDS, inspection_forms: FORMS, inspection_form_questions: [{ id: 3, form_id: 5, question_text: 'Guard fitted' }], sites: SITES, corrective_actions: ACTIONS };
  if (table === 'corrective_actions' && req.method === 'PATCH') { updated.push({ id: url.searchParams.get('id'), payload }); return send(200, []); }
  if (tables[table]) return rows(filt(tables[table]));
  if (table === 'document_assignments') return send(200, []);
  return send(200, []);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: handler } = await import('../../api/monthly.js');
test.after(() => new Promise((r) => server.close(r)));

const fakeRes = () => { const o = { statusCode: null, body: null }; return { o, status(c) { o.statusCode = c; return this; }, json(p) { o.body = p; return this; }, setHeader() {}, end() {} }; };
const call = async (body) => { const r = fakeRes(); await handler({ method: 'POST', body, headers: {}, socket: {} }, r); return r.o; };
const as = (userId, companyId = 7) => mintToken({ role: 'supervisor', userId, companyId });
const ids = (out) => (out.body.actions || []).map((a) => a.id).sort((a, b) => a - b);

test('the Owner sees every action of the company, including one whose source is gone', async () => {
  const out = await call({ action: 'list_corrective_actions', token: as(1) });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.deepEqual(ids(out), [1, 2, 3, 4, 5], 'not company 8\'s action');
});

test('a supervisor sees only actions raised on records they could open', async () => {
  const sue = await call({ action: 'list_corrective_actions', token: as(2) });
  assert.deepEqual(ids(sue), [1, 4], 'Sue: the incident at her site, and the inspection by a safety-department author');
  const sam = await call({ action: 'list_corrective_actions', token: as(3) });
  assert.deepEqual(ids(sam), [4], 'Sam: only the inspection (author in his department)');
});

test('the response never carries the internal author id', async () => {
  const out = await call({ action: 'list_corrective_actions', token: as(2) });
  assert.ok(out.body.actions.every((a) => !('source_author_id' in a)));
});

test('a supervisor cannot update an action raised on a record they cannot open', async () => {
  updated = [];
  const no = await call({ action: 'update_corrective_action', token: as(2), actionId: 2, status: 'resolved' });
  assert.equal(no.statusCode, 403);
  assert.equal(no.body.error, 'Not allowed.');
  const orphan = await call({ action: 'update_corrective_action', token: as(2), actionId: 5, status: 'resolved' });
  assert.equal(orphan.statusCode, 403, 'an action with no source record is the Owner\'s alone');
  const other = await call({ action: 'update_corrective_action', token: as(2), actionId: 6, status: 'resolved' });
  assert.equal(other.statusCode, 403, 'another company\'s action');
  assert.deepEqual(updated, [], 'nothing was written');
});

test('a supervisor can update an action raised on a record they can open; the Owner can update any', async () => {
  updated = [];
  const yes = await call({ action: 'update_corrective_action', token: as(2), actionId: 1, status: 'resolved' });
  assert.equal(yes.statusCode, 200, JSON.stringify(yes.body));
  const owner = await call({ action: 'update_corrective_action', token: as(1), actionId: 5, status: 'resolved' });
  assert.equal(owner.statusCode, 200);
  assert.equal(updated.length, 2);
});
