// The crew lead (server-lib/leadAccess.js), through the REAL handlers behind a
// stand-in PostgREST:
//   - a lead is a worker the Owner flagged; the flag is read live from the
//     roster, so a token claiming it proves nothing
//   - their crew is who shares a department, division or site, workers only
//   - they see their crew's FLHAs and may sign off one, never their own, and
//     cannot edit or delete anything
//   - they give tasks (never restrictions) to their own crew only
//   - they fill in a Daily Report for a crew member: the member is the
//     author, the lead is recorded as having entered it; anyone else, and
//     any other document type, is refused
//   - only the Owner can make someone a lead, and only a worker can be one

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
  P({ id: 1, name: 'Owner Olly', role: 'supervisor', is_owner: true }),
  P({ id: 2, name: 'Sup Sam', role: 'supervisor', departments: ['safety'] }),
  P({ id: 10, name: 'Lead Lee', role: 'worker', is_lead: true, departments: ['safety'] }),
  P({ id: 11, name: 'Crew Cam', role: 'worker', departments: ['safety'] }),
  P({ id: 12, name: 'Other Oz', role: 'worker' }),
  P({ id: 13, name: 'Not Lead Nat', role: 'worker', departments: ['safety'] }),
  P({ id: 14, name: 'Lead Two', role: 'worker', is_lead: true, departments: ['safety'] }),
  P({ id: 15, name: 'Hidden Hal', role: 'worker', departments: ['safety'], hide_unassigned: true }),
  P({ id: 90, name: 'Other Co', role: 'worker', company_id: 8, departments: ['safety'] }),
];
const SETTINGS = ['flha', 'daily', 'fuellog', 'incident'].map(k => ({ company_id: 7, document_key: k, is_active: true }));
const FLHAS = [
  { id: 101, company_id: 7, worker_name: 'Crew Cam', job_site: 'Pit', site_id: null, status: 'pending_approval', submitted_by_roster_id: 11, created_at: '2026-10-01T10:00:00Z', hazards_json: {}, pdf_url: null },
  { id: 102, company_id: 7, worker_name: 'Other Oz', job_site: 'Yard', site_id: null, status: 'pending_approval', submitted_by_roster_id: 12, created_at: '2026-10-02T10:00:00Z', hazards_json: {}, pdf_url: null },
  { id: 104, company_id: 7, worker_name: 'Sup Sam', job_site: 'Pit', site_id: null, status: 'pending_approval', submitted_by_roster_id: 2, created_at: '2026-10-04T10:00:00Z', hazards_json: {}, pdf_url: null },
  { id: 105, company_id: 7, worker_name: 'Crew Cam', job_site: 'Pit', site_id: null, status: 'complete', supervisor_signed_at: '2026-10-02T10:00:00Z', supervisor_signed_by: 'Sup Sam', submitted_by_roster_id: 11, created_at: '2026-10-02T09:00:00Z', hazards_json: {}, pdf_url: null },
  { id: 106, company_id: 7, worker_name: 'Lead Two', job_site: 'Pit', site_id: null, status: 'pending_approval', submitted_by_roster_id: 14, created_at: '2026-10-05T10:00:00Z', hazards_json: {}, pdf_url: null },
  { id: 103, company_id: 7, worker_name: 'Lead Lee', job_site: 'Pit', site_id: null, status: 'pending_approval', submitted_by_roster_id: 10, created_at: '2026-10-03T10:00:00Z', hazards_json: {}, pdf_url: null },
];

const ENGINE_SETTINGS = [{ company_id: 7, definition_id: 55, is_enabled: true }];
const ENGINE_DEFS = [{ id: 55, title: 'Yard Check', company_id: 7, current_version_id: 1, archived_at: null }];
const ENGINE_RECORDS = [
  { id: 1, company_id: 7, definition_id: 55, site_id: null, status: 'submitted', awaiting_signature: false, created_at: '2026-10-06T10:00:00Z', pdf_path: '7/abc-doc.pdf', submitted_by_roster_id: 11 },
  { id: 2, company_id: 7, definition_id: 55, site_id: null, status: 'submitted', awaiting_signature: false, created_at: '2026-10-06T11:00:00Z', pdf_path: null, submitted_by_roster_id: 12 },
  { id: 3, company_id: 7, definition_id: 55, site_id: null, status: 'pending_approval', awaiting_signature: false, created_at: '2026-10-06T12:00:00Z', pdf_path: null, submitted_by_roster_id: 2 },
  { id: 4, company_id: 8, definition_id: 55, site_id: null, status: 'submitted', awaiting_signature: false, created_at: '2026-10-06T13:00:00Z', pdf_path: null, submitted_by_roster_id: 11 },
];

let assignments = [];
let nextId = 500;
const inserted = { daily_reports: [], fuel_logs: [] };
const flhaUpdates = [];
const flhaDeletes = [];

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
    (eq('is_enabled') === null || String(r.is_enabled) === eq('is_enabled')) &&
    (inList('definition_id') === null || inList('definition_id').includes(String(r.definition_id))) &&
    (inList('id') === null || inList('id').includes(String(r.id))));

  if (table === 'company_documents') return send(200, filt(ENGINE_SETTINGS));
  if (table === 'document_definitions') return send(200, filt(ENGINE_DEFS));
  if (table === 'document_records') return send(200, filt(ENGINE_RECORDS));
  if (table === 'roster') return wantsObject ? send(200, filt(ROSTER)[0] || {}) : send(200, filt(ROSTER));
  if (table === 'company_document_settings') return send(200, filt(SETTINGS).filter(s => !eq('document_key') || s.document_key === eq('document_key')));
  if (table === 'flhas') {
    if (req.method === 'PATCH') { flhaUpdates.push({ id: eq('id'), payload }); return send(200, []); }
    if (req.method === 'DELETE') { flhaDeletes.push(eq('id') || url.searchParams.get('id')); return send(200, []); }
    return send(200, filt(FLHAS));
  }
  if (table === 'document_assignments') {
    if (req.method === 'POST') { const row = { id: nextId++, created_at: new Date().toISOString(), ended_at: null, ...payload }; assignments.push(row); return wantsObject ? send(201, row) : send(201, [row]); }
    if (req.method === 'PATCH') {
      const hit = assignments.filter(a => String(a.id) === eq('id') && String(a.company_id) === eq('company_id') && String(a.created_by) === eq('created_by') && String(a.restricts) === eq('restricts') && !a.ended_at);
      hit.forEach(a => { a.ended_at = payload.ended_at; });
      return send(200, hit.map(a => ({ id: a.id })));
    }
    return send(200, filt(assignments).filter(a => !a.ended_at && (eq('created_by') === null || String(a.created_by) === eq('created_by')) && (eq('restricts') === null || String(a.restricts) === eq('restricts'))));
  }
  if (table === 'daily_reports' || table === 'fuel_logs') {
    if (req.method === 'POST') { inserted[table].push(payload); return wantsObject ? send(201, { id: 900 }) : send(201, [{ id: 900 }]); }
    return send(200, []);
  }
  if (table === 'custom_forms' || table === 'portal_documents') return send(200, []);
  if (table === 'audit_log') return send(201, []);
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
const { default: companydata } = await import('../../api/companydata.js');
const { default: flhas } = await import('../../api/flhas.js');
const { default: logs } = await import('../../api/logs.js');
const { default: customforms } = await import('../../api/customforms.js');
test.after(() => new Promise(r => server.close(r)));

function fakeRes() {
  const out = { statusCode: null, body: null };
  return { out, status(c) { out.statusCode = c; return this; }, json(p) { out.body = p; return this; }, setHeader() {}, end() {} };
}
const run = async (handler, body) => { const r = fakeRes(); await handler({ method: 'POST', body, headers: {}, socket: {} }, r); return r.out; };
const as = (userId, role) => mintToken({ role, userId, companyId: 7 });
const LEAD = () => as(10, 'worker');

test('get_my_crew: a lead gets their crew, workers only, not themselves or other companies', async () => {
  const out = await run(companydata, { action: 'get_my_crew', token: LEAD() });
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.isLead, true);
  assert.deepEqual(out.body.crew.map(p => p.name).sort(), ['Crew Cam', 'Hidden Hal', 'Lead Two', 'Not Lead Nat']);
});

test('get_my_crew: anyone else is simply not a lead, and a token claim proves nothing', async () => {
  const worker = await run(companydata, { action: 'get_my_crew', token: as(13, 'worker') });
  assert.deepEqual(worker.body, { isLead: false, crew: [] });
  const lie = await run(companydata, { action: 'get_my_crew', token: mintToken({ role: 'worker', userId: 13, companyId: 7, isLead: true }) });
  assert.equal(lie.body.isLead, false);
});

test('a lead lists their crew\'s FLHAs, not other people\'s', async () => {
  const out = await run(flhas, { action: 'list', token: LEAD() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  // Their crew's own FLHAs: not the supervisor's (104) at a shared tag, not an
  // unrelated worker's (102), not their own (103).
  assert.deepEqual(out.body.flhas.map(f => f.id).sort(), [101, 105, 106]);
  const worker = await run(flhas, { action: 'list', token: as(13, 'worker') });
  assert.equal(worker.statusCode, 403);
});

test('a lead signs off a crew FLHA, never their own, never one outside the crew', async () => {
  flhaUpdates.length = 0;
  const ok = await run(flhas, { action: 'approve', token: LEAD(), id: 101, supName: 'Somebody Else', supSignature: 'data:image/png;base64,AAAA' });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const stamped = flhaUpdates.find(u => u.payload && u.payload.supervisor_signed_by);
  assert.equal(stamped.payload.supervisor_signed_by, 'Lead Lee', 'the name on the sign-off is the lead\'s own, from the roster');
  const own = await run(flhas, { action: 'approve', token: LEAD(), id: 103, supName: 'Lead Lee', supSignature: 'data:image/png;base64,AAAA' });
  assert.equal(own.statusCode, 403);
  const outside = await run(flhas, { action: 'approve', token: LEAD(), id: 102, supName: 'Lead Lee', supSignature: 'data:image/png;base64,AAAA' });
  assert.equal(outside.statusCode, 403);
  const plain = await run(flhas, { action: 'approve', token: as(13, 'worker'), id: 101, supName: 'x', supSignature: 'data:image/png;base64,AAAA' });
  assert.equal(plain.statusCode, 403);
});

test('a lead cannot sign off a supervisor\'s FLHA, another lead\'s, or one already signed', async () => {
  const sig = 'data:image/png;base64,AAAA';
  const supervisors = await run(flhas, { action: 'approve', token: LEAD(), id: 104, supName: 'x', supSignature: sig });
  assert.equal(supervisors.statusCode, 403, 'a supervisor\'s own FLHA');
  const otherLead = await run(flhas, { action: 'approve', token: LEAD(), id: 106, supName: 'x', supSignature: sig });
  assert.equal(otherLead.statusCode, 403, 'another lead\'s FLHA needs a supervisor');
  const signed = await run(flhas, { action: 'approve', token: LEAD(), id: 105, supName: 'x', supSignature: sig });
  assert.equal(signed.statusCode, 409, 'an existing sign-off is never replaced');
});

test('a lead cannot edit or delete an FLHA', async () => {
  for (const body of [{ action: 'update', id: 101, fields: { worker_name: 'x' } }, { action: 'delete', ids: [101] }]) {
    const out = await run(flhas, { ...body, token: LEAD() });
    assert.equal(out.statusCode, 403, body.action);
  }
});

test('a lead gives a crew member a task, which never restricts, and cannot reach past the crew', async () => {
  assignments = [];
  const ok = await run(companydata, { action: 'lead_assign_task', token: LEAD(), documentKey: 'flha', personId: 11, dueAt: '2026-12-01' });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(assignments[0].restricts, false);
  assert.equal(assignments[0].audience_type, 'individual');
  assert.equal(assignments[0].created_by, 10);
  assert.equal((await run(companydata, { action: 'lead_assign_task', token: LEAD(), documentKey: 'flha', personId: 12 })).statusCode, 403, 'not on the crew');
  assert.equal((await run(companydata, { action: 'lead_assign_task', token: LEAD(), documentKey: 'flha', personId: 90 })).statusCode, 403, 'another company');
  assert.equal((await run(companydata, { action: 'lead_assign_task', token: LEAD(), documentKey: 'flha', personId: 2 })).statusCode, 403, 'a supervisor is not crew');
  assert.equal((await run(companydata, { action: 'lead_assign_task', token: LEAD(), documentKey: 'timeclock', personId: 11 })).statusCode, 400);
  assert.equal((await run(companydata, { action: 'lead_assign_task', token: LEAD(), documentKey: 'flha', personId: 11 })).statusCode, 409, 'duplicate');
  assert.equal((await run(companydata, { action: 'lead_assign_task', token: as(13, 'worker'), documentKey: 'flha', personId: 11 })).statusCode, 403, 'not a lead');
});

test('a lead\'s task cannot undo the Owner: not for a hidden person, not past a restriction', async () => {
  assignments = [];
  const hidden = await run(companydata, { action: 'lead_assign_task', token: LEAD(), documentKey: 'flha', personId: 15 });
  assert.equal(hidden.statusCode, 403, 'the Owner limits what Hidden Hal sees');
  assert.equal(assignments.length, 0);
  assignments = [{ id: 700, company_id: 7, created_by: 1, restricts: true, action: 'submit', audience_type: 'role', audience_value: 'supervisor', document_key: 'incident', ended_at: null, created_at: '2026-01-01T00:00:00Z' }];
  const restricted = await run(companydata, { action: 'lead_assign_task', token: LEAD(), documentKey: 'incident', personId: 11 });
  assert.equal(restricted.statusCode, 403, 'the Owner restricted Incident Reports to supervisors');
  assert.equal(assignments.length, 1);
});

test('a lead\'s task is marked as theirs', async () => {
  assignments = [];
  const ok = await run(companydata, { action: 'lead_assign_task', token: LEAD(), documentKey: 'flha', personId: 11 });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(assignments[0].by_lead, true);
});

test('a lead can end only their own tasks, never the Owner\'s assignments', async () => {
  assignments = [
    { id: 600, company_id: 7, created_by: 10, restricts: false, action: 'submit', audience_type: 'individual', audience_value: '11', document_key: 'flha', ended_at: null, created_at: new Date().toISOString() },
    { id: 601, company_id: 7, created_by: 1, restricts: true, action: 'submit', audience_type: 'role', audience_value: 'worker', document_key: 'flha', ended_at: null, created_at: new Date().toISOString() },
    { id: 602, company_id: 7, created_by: 1, restricts: false, action: 'submit', audience_type: 'individual', audience_value: '11', document_key: 'incident', ended_at: null, created_at: new Date().toISOString() },
  ];
  assert.equal((await run(companydata, { action: 'lead_end_task', token: LEAD(), id: 601 })).statusCode, 404);
  assert.equal((await run(companydata, { action: 'lead_end_task', token: LEAD(), id: 602 })).statusCode, 404, 'an Owner task is not theirs');
  assert.equal((await run(companydata, { action: 'lead_end_task', token: LEAD(), id: 600 })).statusCode, 200);
  assert.ok(assignments.find(a => a.id === 600).ended_at);
  assert.equal(assignments.find(a => a.id === 601).ended_at, null);
});

const DAILY = { type: 'daily', action: 'submit', record: { reporter_name: 'Lead Lee', site: 'Pit', report_date: '2026-10-06', weather: 'Clear', crew: 'x', equipment: 'y', visitors: '', report_json: {}, pdf_url: null } };

test('a lead fills in a Daily Report for a crew member: the member is the author, the lead is recorded', async () => {
  inserted.daily_reports.length = 0;
  const out = await run(logs, { ...DAILY, token: LEAD(), onBehalfOfRosterId: 11, clientSubmissionId: 'cs-1' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  const row = inserted.daily_reports[0];
  assert.equal(row.submitted_by_roster_id, 11);
  assert.equal(row.entered_by_roster_id, 10);
  assert.equal(row.reporter_name, 'Crew Cam', 'the name on the document is the member\'s, stamped server-side');
});

test('an ordinary Daily Report carries no entered_by (a database without the column is unaffected)', async () => {
  inserted.daily_reports.length = 0;
  const out = await run(logs, { ...DAILY, token: as(13, 'worker'), clientSubmissionId: 'cs-2' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(Object.prototype.hasOwnProperty.call(inserted.daily_reports[0], 'entered_by_roster_id'), false);
  assert.equal(inserted.daily_reports[0].submitted_by_roster_id, 13);
});

test('filling in for someone is refused for a non-lead, outside the crew, yourself, and any other document', async () => {
  inserted.daily_reports.length = 0;
  const nonLead = await run(logs, { ...DAILY, token: as(13, 'worker'), onBehalfOfRosterId: 11 });
  assert.equal(nonLead.statusCode, 403);
  const outside = await run(logs, { ...DAILY, token: LEAD(), onBehalfOfRosterId: 12 });
  assert.equal(outside.statusCode, 403);
  const self = await run(logs, { ...DAILY, token: LEAD(), onBehalfOfRosterId: 10 });
  assert.equal(self.statusCode, 403);
  const owner = await run(logs, { ...DAILY, token: LEAD(), onBehalfOfRosterId: 1 });
  assert.equal(owner.statusCode, 403, 'reaching up to an owner or supervisor');
  const incident = await run(logs, { type: 'incident', action: 'submit', token: LEAD(), onBehalfOfRosterId: 11, record: { reporter_name: 'x' } });
  assert.equal(incident.statusCode, 400, 'a signed document is never filled in for someone');
  assert.deepEqual(inserted.daily_reports, []);
});

test('only the Owner makes someone a lead, and only a worker can be one', async () => {
  const sup = await run(companydata, { action: 'update_worker_profile', token: as(2, 'supervisor'), id: 11, isLead: true });
  assert.equal(sup.statusCode, 403, 'a supervisor cannot');
  const self = await run(companydata, { action: 'update_worker_profile', token: LEAD(), id: 10, isLead: false });
  assert.equal(self.statusCode, 403, 'and a lead cannot hand it out or drop it');
  const supervisorRow = await run(companydata, { action: 'update_worker_profile', token: as(1, 'supervisor'), id: 2, isLead: true });
  assert.equal(supervisorRow.statusCode, 400, 'a supervisor cannot be a lead');
  const bad = await run(companydata, { action: 'update_worker_profile', token: as(1, 'supervisor'), id: 11, isLead: 'yes' });
  assert.equal(bad.statusCode, 400);
  const ok = await run(companydata, { action: 'update_worker_profile', token: as(1, 'supervisor'), id: 11, isLead: true });
  assert.notEqual(ok.statusCode, 403, JSON.stringify(ok.body));
  assert.notEqual(ok.statusCode, 400, JSON.stringify(ok.body));
});

test('the crew documents list is for leads only', async () => {
  assert.equal((await run(customforms, { action: 'get_crew_documents', token: as(13, 'worker') })).statusCode, 403);
  const out = await run(customforms, { action: 'get_crew_documents', token: LEAD() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.ok(Array.isArray(out.body.documents));
});

test('a crew document saved to sign afterwards is labelled for the lead, not hidden', async () => {
  const row = FLHAS.find(f => f.id === 101);
  row.awaiting_signature = true; row.signature_requested_at = '2026-10-01T10:00:00Z';
  try {
    const out = await run(customforms, { action: 'get_crew_documents', token: LEAD() });
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    const hit = out.body.documents.find(d => d.type === 'flha' && d.id === 101);
    assert.ok(hit, 'still listed');
    assert.equal(hit.awaitingSignature, true);
    const signed = out.body.documents.find(d => d.type === 'flha' && d.id === 105);
    if (signed) assert.equal(signed.awaitingSignature, false);
  } finally {
    delete row.awaiting_signature; delete row.signature_requested_at;
  }
});


test('the crew list includes engine documents the crew wrote, and only those', async () => {
  const out = await run(customforms, { action: 'get_crew_documents', token: LEAD() });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  const engine = out.body.documents.filter(d => d.type === 'engine');
  // Crew Cam (11) is on the crew. Other Oz (12), the supervisor (2) and another company's record are not.
  assert.deepEqual(engine.map(d => d.id), [1]);
  assert.equal(engine[0].title, 'Yard Check');
  assert.equal(engine[0].author, 'Crew Cam');
  assert.equal(engine[0].status, 'submitted');
});
