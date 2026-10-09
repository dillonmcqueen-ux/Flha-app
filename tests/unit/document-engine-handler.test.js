// Drives the REAL api/documents.js behind a stand-in PostgREST. What it pins
// is the handler's own job: who may call which action, and which company a
// call is about. The rules behind it are in document-engine-service.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

const SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SESSION_SECRET = SESSION_SECRET;
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

function mintToken(payload) {
  const data = Buffer.from(JSON.stringify({ issuedAt: Date.now(), ...payload })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

// Roster ids encode role and company: 11 is a worker of company 1, 21 a
// supervisor of company 1, 99 an auditor of company 1.
function rosterRow(id) {
  const role = id === 99 ? 'auditor' : id >= 20 ? 'supervisor' : 'worker';
  return { id, active: true, role, company_id: 1, name: `Person ${id}`, is_owner: false, departments: [], divisions: [] };
}

const calls = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  await new Promise((r) => { req.on('data', () => {}); req.on('end', r); });
  calls.push({ method: req.method, table, query: url.search });
  const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
  const eq = (key) => (url.searchParams.get(key) || '').replace('eq.', '');
  if (table === 'roster') {
    const id = Number(eq('id'));
    return send(200, id ? [rosterRow(id)] : []);
  }
  return send(req.method === 'POST' ? 201 : 200, []);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise((r) => server.close(r)));

const { default: handler } = await import('../../api/documents.js');

async function call(body, method = 'POST') {
  const out = { statusCode: null, body: null };
  const res = { status(c) { out.statusCode = c; return this; }, json(p) { out.body = p; return this; } };
  await handler({ method, body }, res);
  return out;
}

const worker = mintToken({ role: 'worker', companyId: 1, userId: 11 });
const supervisor = mintToken({ role: 'supervisor', companyId: 1, userId: 21 });
const auditor = mintToken({ role: 'auditor', companyId: 1, userId: 99 });
const admin = mintToken({ role: 'admin' });
const ticket = mintToken({ purpose: 'roster', companyId: 1 });

test('only POST is accepted', async () => {
  assert.equal((await call({}, 'GET')).statusCode, 405);
});

test('no token, a bad token, a login ticket and an auditor are all refused', async () => {
  for (const token of [undefined, 'nope', `${worker.split('.')[0]}.bad`, ticket, auditor]) {
    const out = await call({ action: 'list_worker_documents', token });
    assert.equal(out.statusCode, 401, String(token).slice(0, 20));
  }
});

const BUILDER = ['engine_info', 'list_company_documents', 'create_definition', 'clone_template', 'get_definition', 'save_draft', 'publish', 'set_company_document'];

test('every builder action is founder only and refuses workers and supervisors before touching data', async () => {
  for (const action of BUILDER) {
    for (const token of [worker, supervisor]) {
      const before = calls.length;
      const out = await call({ action, token, companyId: 1, definitionId: 1, title: 'x' });
      assert.equal(out.statusCode, 403, action);
      const touched = calls.slice(before).map((c) => c.table).filter((t) => t !== 'roster');
      assert.deepEqual(touched, [], `${action} must not reach data once refused`);
    }
  }
});

test('the founder gets the engine info', async () => {
  const out = await call({ action: 'engine_info', token: admin });
  assert.equal(out.statusCode, 200);
  assert.ok(out.body.fieldTypes.length > 10);
  assert.ok(out.body.ruleTypes.includes('reviewer_step'));
});

test('a worker call is about the worker\'s own company, whatever companyId the body claims', async () => {
  const before = calls.length;
  const out = await call({ action: 'list_worker_documents', token: worker, companyId: 2 });
  assert.equal(out.statusCode, 200);
  const q = calls.slice(before).filter((c) => c.table === 'company_documents').map((c) => c.query).join(' ');
  assert.match(q, /company_id=eq\.1/);
  assert.doesNotMatch(q, /company_id=eq\.2/);
});

test('a founder must name a company for company actions', async () => {
  const out = await call({ action: 'list_worker_documents', token: admin });
  assert.equal(out.statusCode, 400);
  const named = await call({ action: 'list_worker_documents', token: admin, companyId: 2 });
  assert.equal(named.statusCode, 200);
});

test('an unknown action is a 400, and an engine error keeps its own status', async () => {
  assert.equal((await call({ action: 'wipe', token: worker })).statusCode, 400);
  const missing = await call({ action: 'get_document', token: worker, definitionId: 5 });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error, 'Document not found.');
});

test('an upload kind the engine does not know is refused', async () => {
  assert.equal((await call({ action: 'create_upload_url', token: worker, kind: 'exe', filename: 'a.exe' })).statusCode, 400);
});

test('a worker cannot review', async () => {
  const out = await call({ action: 'review', token: worker, recordId: 1, decision: 'approve' });
  assert.equal(out.statusCode, 403);
});

test('an inherited object key is not an upload kind', async () => {
  for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal((await call({ action: 'create_upload_url', token: worker, kind, filename: 'a.pdf' })).statusCode, 400, kind);
  }
});

test('a missing company is never read as "template": the founder must say so', async () => {
  for (const action of ['create_definition', 'get_definition', 'save_draft', 'publish']) {
    const out = await call({ action, token: admin, definitionId: 1, title: 'x' });
    assert.equal(out.statusCode, 400, action);
    assert.match(out.body.error, /scope to template/);
  }
  const both = await call({ action: 'save_draft', token: admin, definitionId: 1, companyId: 1, scope: 'template' });
  assert.equal(both.statusCode, 400);
  const named = await call({ action: 'get_definition', token: admin, definitionId: 1, companyId: 1 });
  assert.equal(named.statusCode, 404, 'a named company passes the scope check and reaches the service');
});
