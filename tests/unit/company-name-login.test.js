// Company-name login (api/login.js: search_companies, list_roster_names) and
// the 12 hour supervisor session (server-lib/sessionTtl.js).
//
// What has to hold:
//   - the search is public, so it needs 3+ letters, returns at most 8 names,
//     escapes LIKE wildcards, and is throttled per IP;
//   - a ticket from a search opens that company's name list and nothing else,
//     and the list carries names only (no role);
//   - the shared worker/supervisor company codes are gone: only the founder
//     codes remain on the old code-entry path;
//   - a supervisor session expires after 12 hours, a worker session after 7 days.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.ADMIN_CODE = 'a-long-admin-code-123456';

let companies; // what the fake companies table answers
let rosterRows; // what the fake roster table answers
let throttleCount; // what bump_ip_throttle returns
let seen; // every request the handler sent: { table, query }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  let raw = '';
  await new Promise(r => { req.on('data', c => { raw += c; }); req.on('end', r); });
  seen.push({ table, query: Object.fromEntries(url.searchParams), body: raw });
  const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
  if (table === 'rpc/bump_ip_throttle') return send(200, throttleCount);
  if (table === 'companies') return send(200, companies);
  if (table === 'roster') return send(200, rosterRows);
  return send(200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(r => server.close(r)));

const { default: handler } = await import('../../api/login.js');
const { sessionExpired, SUPERVISOR_SESSION_TTL_MS, WORKER_SESSION_TTL_MS } = await import('../../server-lib/sessionTtl.js');

async function call(body) {
  const out = { statusCode: null, body: null };
  await handler({ method: 'POST', body, headers: {} }, {
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
  });
  return out;
}

test.beforeEach(() => {
  companies = [{ id: 1, name: 'ABC Earthworks Company' }, { id: 5, name: 'ABC Safety' }];
  rosterRows = [{ id: 11, name: 'Jamie Worker' }, { id: 12, name: 'Sam Supervisor' }];
  throttleCount = 1;
  seen = [];
});

test('a search under 3 letters answers nothing and never touches the database', async () => {
  const out = await call({ action: 'search_companies', query: 'AB' });
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.body.companies, []);
  assert.equal(seen.some(r => r.table === 'companies'), false);
});

test('a search returns names with a ticket each, capped at 8', async () => {
  const out = await call({ action: 'search_companies', query: '  abc ' });
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.companies.length, 2);
  assert.equal(out.body.companies[0].name, 'ABC Earthworks Company');
  assert.ok(out.body.companies[0].companyTicket);
  // The ticket carries the company, but the response never hands back a raw id.
  assert.equal(out.body.companies[0].id, undefined);
  const q = seen.find(r => r.table === 'companies').query;
  assert.equal(q.limit, '8');
  assert.equal(q.select, 'id,name');
});

test('LIKE wildcards in the search are escaped, not honored', async () => {
  await call({ action: 'search_companies', query: '%%%' });
  const q = seen.find(r => r.table === 'companies').query;
  assert.match(q.name, /^ilike\./);
  assert.ok(q.name.includes('\\%'), `expected escaped wildcard in ${q.name}`);
});

test('the search is throttled per IP', async () => {
  throttleCount = 100000;
  const out = await call({ action: 'search_companies', query: 'abc' });
  assert.equal(out.statusCode, 429);
  assert.equal(seen.some(r => r.table === 'companies'), false);
});

test('a search ticket opens the name list, which carries names only', async () => {
  const search = await call({ action: 'search_companies', query: 'abc' });
  const out = await call({ action: 'list_roster_names', companyTicket: search.body.companies[0].companyTicket });
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.companyName, 'ABC Earthworks Company');
  assert.deepEqual(out.body.names.map(n => n.name), ['Jamie Worker', 'Sam Supervisor']);
  const q = seen.find(r => r.table === 'roster').query;
  assert.equal(q.select, 'id,name'); // no role, so a stranger cannot tell who the supervisors are
  assert.equal(q.active, 'eq.true');
});

test('a forged or missing ticket opens nothing', async () => {
  assert.equal((await call({ action: 'list_roster_names', companyTicket: 'x.y' })).statusCode, 401);
  assert.equal((await call({ action: 'list_roster_names' })).statusCode, 401);
  assert.equal(seen.some(r => r.table === 'roster'), false);
});

test('the shared company-code path is gone: worker and supervisor codes are refused', async () => {
  for (const role of ['worker', 'supervisor']) {
    const out = await call({ role, code: 'ABC' });
    assert.equal(out.statusCode, 400, role);
    assert.equal(out.body.session, undefined);
    assert.equal(out.body.companyTicket, undefined);
  }
  assert.equal(seen.some(r => r.table === 'companies'), false);
});

test('the founder codes still work: the admin code gets an admin session', async () => {
  const out = await call({ role: 'admin', code: process.env.ADMIN_CODE });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body.session.role, 'admin');
});

test('a wrong founder code is refused', async () => {
  const out = await call({ role: 'admin', code: 'nope' });
  assert.equal(out.statusCode, 401);
});

test('a supervisor session lasts 12 hours, a worker session 7 days', () => {
  const now = Date.now();
  const sup = { role: 'supervisor', userId: 3, issuedAt: now - SUPERVISOR_SESSION_TTL_MS - 1000 };
  assert.equal(sessionExpired(sup, now), true);
  assert.equal(sessionExpired({ ...sup, issuedAt: now - SUPERVISOR_SESSION_TTL_MS + 60_000 }, now), false);

  const worker = { role: 'worker', userId: 4, issuedAt: now - WORKER_SESSION_TTL_MS + 60_000 };
  assert.equal(sessionExpired(worker, now), false);
  assert.equal(sessionExpired({ ...worker, issuedAt: now - WORKER_SESSION_TTL_MS - 1000 }, now), true);

  // 13 hours old: dead for a supervisor, fine for a worker.
  const old = now - 13 * 60 * 60 * 1000;
  assert.equal(sessionExpired({ role: 'supervisor', userId: 3, issuedAt: old }, now), true);
  assert.equal(sessionExpired({ role: 'worker', userId: 4, issuedAt: old }, now), false);
});

test('the founder sessions and anything without an issue time are not given the short window', () => {
  const now = Date.now();
  // Founder sessions (no userId) keep the 7 day server window; the browser
  // holds them per tab only.
  assert.equal(sessionExpired({ role: 'admin', issuedAt: now - 24 * 60 * 60 * 1000 }, now), false);
  assert.equal(sessionExpired({ role: 'supervisor', issuedAt: now - 24 * 60 * 60 * 1000 }, now), false);
  assert.equal(sessionExpired({ role: 'worker' }, now), true);
  assert.equal(sessionExpired(null, now), true);
});
