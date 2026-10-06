// Company-code login (api/login.js: find_company, list_roster_names,
// request_unlock_link) and the 12 hour supervisor session
// (server-lib/sessionTtl.js).
//
// What has to hold:
//   - the lookup is an exact match on a code the founder chose, never a search
//     or a list, so a stranger cannot browse which companies are on FORA;
//   - only misses spend the failure budget, and a spent budget refuses the next
//     guess before the lookup;
//   - a ticket opens that company's name list and nothing else, and the list
//     carries names only (no role);
//   - the shared worker/supervisor codes are gone: only the founder codes remain
//     on the old code-entry path;
//   - the Account Owner, and only the Owner, can email themselves an unlock link,
//     and only while locked;
//   - a supervisor session expires after 12 hours, a worker session after 7 days.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.ADMIN_CODE = 'a-long-admin-code-123456';

let companies; // what the fake companies table answers
let rosterRows; // what the fake roster table answers
let throttleCount; // what bump_ip_throttle returns
let missRow; // what the failure-budget read finds in master_code_ip_limits
let seen; // every request the handler sent: { table, query }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  let raw = '';
  await new Promise(r => { req.on('data', c => { raw += c; }); req.on('end', r); });
  seen.push({ table, query: Object.fromEntries(url.searchParams), body: raw });
  const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
  if (table === 'rpc/bump_ip_throttle') return send(200, throttleCount);
  if (table === 'master_code_ip_limits') return send(200, missRow ? [missRow] : []);
  if (table === 'rpc/claim_pin_attempt') return send(200, [{ failed_pin_attempts: 1, pin_locked_until: null }]);
  if (table === 'companies') return send(200, companies);
  if (table === 'roster') return send(200, rosterRows);
  return send(200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(r => server.close(r)));

const { default: handler } = await import('../../api/login.js');
const { default: companyData } = await import('../../api/companydata.js');
const { isWeakPin } = await import('../../server-lib/weakPins.js');
const { ipBucket } = await import('../../server-lib/ipThrottle.js');
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
  companies = [{ id: 1, name: 'ABC Earthworks Company' }];
  rosterRows = [{ id: 11, name: 'Jamie Worker' }, { id: 12, name: 'Sam Supervisor' }];
  throttleCount = 1;
  missRow = null;
  seen = [];
});

const find = (code) => call({ action: 'find_company', code });
const bumps = () => seen.filter(r => r.table === 'rpc/bump_ip_throttle').map(r => JSON.parse(r.body).p_key.split(':')[0]);

test('the right code gives back the company name and a ticket, and never a list', async () => {
  const out = await find('  abcworks ');
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body.companyName, 'ABC Earthworks Company');
  assert.ok(out.body.companyTicket);
  assert.equal(out.body.companies, undefined);
  assert.equal(out.body.id, undefined); // never a raw company id
  const q = seen.find(r => r.table === 'companies').query;
  assert.equal(q.company_code, 'ilike.ABCWORKS'); // trimmed, upper-cased, exact
  assert.equal(q.limit, '1');
});

test('an unknown code is a 401 and spends the failure budget; a right one does not', async () => {
  companies = [];
  const miss = await find('NOPE123');
  assert.equal(miss.statusCode, 401);
  assert.ok(bumps().includes('ccode'), 'a miss is counted');

  seen = [];
  companies = [{ id: 1, name: 'ABC Earthworks Company' }];
  await find('ABCWORKS');
  assert.equal(bumps().includes('ccode'), false, 'a hit is not counted against the failure budget');
});

test('codes with wildcards or odd characters never reach the database', async () => {
  for (const bad of ['%%%', 'A_C', 'a*b', '', 'ab', 'ABC', 'ABCDE', 'x'.repeat(33), "ABC'; --"]) {
    const out = await find(bad);
    assert.equal(out.statusCode, 401, bad);
  }
  assert.equal(seen.some(r => r.table === 'companies'), false);
});

test('a spent failure budget refuses the next guess before looking anything up', async () => {
  missRow = { window_start: new Date().toISOString(), count: 20 };
  const out = await find('ABCWORKS');
  assert.equal(out.statusCode, 429);
  assert.equal(seen.some(r => r.table === 'companies'), false);
});

test('an expired failure window starts fresh', async () => {
  missRow = { window_start: new Date(Date.now() - 3600_000).toISOString(), count: 20 };
  const out = await find('ABCWORKS');
  assert.equal(out.statusCode, 200);
});

test('the lookup volume is throttled per IP', async () => {
  throttleCount = 100000;
  const out = await find('ABCWORKS');
  assert.equal(out.statusCode, 429);
  assert.equal(seen.some(r => r.table === 'companies'), false);
});

test('the old company search is gone', async () => {
  const out = await call({ action: 'search_companies', query: 'abc' });
  assert.notEqual(out.statusCode, 200);
  assert.equal(out.body.companies, undefined);
});

test('a company ticket opens the name list, which carries names only', async () => {
  const found = await find('ABCWORKS');
  const out = await call({ action: 'list_roster_names', companyTicket: found.body.companyTicket });
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

test('founder sessions get the short window too, and a session with no issue time is expired', () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  assert.equal(sessionExpired({ role: 'admin', issuedAt: now - day }, now), true);
  assert.equal(sessionExpired({ role: 'admin', issuedAt: now - 60_000 }, now), false);
  assert.equal(sessionExpired({ role: 'supervisor', founder: true, issuedAt: now - day }, now), true);
  assert.equal(sessionExpired({ role: 'worker' }, now), true);
  assert.equal(sessionExpired(null, now), true);
});

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}
async function callData(body) {
  const out = { statusCode: null, body: null };
  await companyData({ method: 'POST', body, headers: {} }, {
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
  });
  return out;
}

test('a leftover shared-code session (supervisor, no userId, no founder flag) is refused', async () => {
  const token = signToken({ role: 'supervisor', companyId: 1, companyName: 'ABC', suspended: false, issuedAt: Date.now() });
  const out = await callData({ action: 'list_roster', token });
  assert.equal(out.statusCode, 401);
});

test('a founder session opened on a company is still accepted', async () => {
  const token = signToken({ role: 'supervisor', founder: true, companyId: 1, companyName: 'ABC', suspended: false, issuedAt: Date.now() });
  const out = await callData({ action: 'list_roster', token });
  assert.notEqual(out.statusCode, 401);
});

test('the name list is throttled per IP', async () => {
  const found = await find('ABCWORKS');
  throttleCount = 100000;
  const out = await call({ action: 'list_roster_names', companyTicket: found.body.companyTicket });
  assert.equal(out.statusCode, 429);
});

test('a lock that has run out starts a fresh set of attempts', async () => {
  const salt = 'abcd';
  const hash = crypto.scryptSync('482913', salt, 64).toString('hex');
  rosterRows = [{ id: 11, name: 'Jamie Worker', role: 'worker', active: true, company_id: 1, failed_pin_attempts: 8, pin_locked_until: new Date(Date.now() - 60_000).toISOString(), pin_salt: salt, pin_hash: hash, totp_enabled: false, departments: [] }];
  const found = await find('ABCWORKS');
  seen = [];
  const out = await call({ action: 'roster_login', companyTicket: found.body.companyTicket, rosterId: 11, pin: '000999' });
  assert.equal(out.statusCode, 401);
  const resetIdx = seen.findIndex(r => r.table === 'roster' && r.body.includes('"failed_pin_attempts":0'));
  const claimIdx = seen.findIndex(r => r.table === 'rpc/claim_pin_attempt');
  assert.ok(resetIdx >= 0, 'the expired lock was cleared');
  assert.ok(resetIdx < claimIdx, 'and cleared before the new attempt was counted');
});

test('a lock that is still running is left alone', async () => {
  const salt = 'abcd';
  rosterRows = [{ id: 11, name: 'Jamie Worker', role: 'worker', active: true, company_id: 1, failed_pin_attempts: 8, pin_locked_until: new Date(Date.now() + 600_000).toISOString(), pin_salt: salt, pin_hash: 'x', totp_enabled: false, departments: [] }];
  const found = await find('ABCWORKS');
  seen = [];
  const out = await call({ action: 'roster_login', companyTicket: found.body.companyTicket, rosterId: 11, pin: '000999' });
  assert.equal(out.statusCode, 403);
  assert.equal(out.body.locked, true); // the screen uses this to offer the Owner's unlock link
  assert.equal(seen.some(r => r.table === 'roster' && r.body.includes('failed_pin_attempts')), false);
});

test('PINs an attacker tries first are refused at set time', () => {
  for (const p of ['000000', '111111', '123456', '654321', '234567', '121212', '123123', '112233', '696969']) {
    assert.equal(isWeakPin(p), true, p);
  }
  for (const p of ['482913', '730194', '905317']) assert.equal(isWeakPin(p), false, p);
});

test('a worker cannot pick a trivial PIN from their setup link', async () => {
  const { signPinLinkTicket, hashJti } = await import('../../server-lib/setupLinks.js');
  rosterRows = [{ id: 1, company_id: 7, name: 'New Hire', role: 'worker', active: true, email: null, departments: [], totp_enabled: false, is_owner: false, pin_link_jti_hash: hashJti('j'), pin_link_expires_at: new Date(Date.now() + 3600_000).toISOString() }];
  const out = await call({ action: 'pin_link_set_pin', linkToken: signPinLinkTicket({ rosterId: 1, companyId: 7, jti: 'j' }), pin: '123456' });
  assert.equal(out.statusCode, 400);
  assert.match(out.body.error, /too easy/);
});


// ── Account Owner unlock link ────────────────────────────────────────────
function ownerRow(over = {}) {
  return {
    id: 21, name: 'Olive Owner', role: 'supervisor', is_owner: true, active: true, company_id: 1,
    email: 'owner@example.com', departments: [], totp_enabled: true,
    pin_locked_until: new Date(Date.now() + 600_000).toISOString(),
    totp_locked_until: null, pin_link_sent_at: null,
    ...over,
  };
}
const unlockCall = async (row) => {
  rosterRows = [row];
  const found = await find('ABCWORKS');
  seen = [];
  const out = await call({ action: 'request_unlock_link', companyTicket: found.body.companyTicket, rosterId: row.id });
  const issued = seen.some(r => r.table === 'roster' && r.body.includes('pin_link_jti_hash'));
  return { out, issued };
};

test('a locked Account Owner with an email on file is sent an unlock link', async () => {
  const { out, issued } = await unlockCall(ownerRow());
  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.body, { ok: true });
  assert.equal(issued, true);
});

test('the answer is identical when nothing was sent, so it leaks nothing', async () => {
  const cases = {
    'not the Owner': ownerRow({ is_owner: false }),
    'not locked': ownerRow({ pin_locked_until: null }),
    'no email on file': ownerRow({ email: null }),
    'deactivated': ownerRow({ active: false }),
    'emailed within the hour': ownerRow({ pin_link_sent_at: new Date().toISOString() }),
  };
  for (const [label, row] of Object.entries(cases)) {
    const { out, issued } = await unlockCall(row);
    assert.equal(out.statusCode, 200, label);
    assert.deepEqual(out.body, { ok: true }, label);
    assert.equal(issued, false, label);
  }
});

test('a lock that has already run out sends nothing', async () => {
  const { issued } = await unlockCall(ownerRow({ pin_locked_until: new Date(Date.now() - 1000).toISOString() }));
  assert.equal(issued, false);
});

test('an authenticator lockout counts too', async () => {
  const { issued } = await unlockCall(ownerRow({ pin_locked_until: null, totp_locked_until: new Date(Date.now() + 600_000).toISOString() }));
  assert.equal(issued, true);
});

test('the unlock link needs a real ticket and is throttled per IP', async () => {
  assert.equal((await call({ action: 'request_unlock_link', companyTicket: 'x.y', rosterId: 21 })).statusCode, 401);
  rosterRows = [ownerRow()];
  const found = await find('ABCWORKS');
  throttleCount = 100000;
  const out = await call({ action: 'request_unlock_link', companyTicket: found.body.companyTicket, rosterId: 21 });
  assert.equal(out.statusCode, 429);
});


test('an IPv6 caller is counted by its /64, so rotating addresses inside it buys nothing', () => {
  assert.equal(ipBucket('203.0.113.7'), '203.0.113.7');
  const a = ipBucket('2001:db8:abcd:12:1111:2222:3333:4444');
  const b = ipBucket('2001:0db8:abcd:0012:ffff:eeee:dddd:cccc');
  assert.equal(a, b);
  assert.equal(a, '2001:db8:abcd:12::/64');
  assert.equal(ipBucket('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipBucket('::1'), '0:0:0:0::/64');
  assert.notEqual(ipBucket('2001:db8:abcd:13::1'), a); // a different /64 is a different customer
  assert.equal(ipBucket('::ffff:203.0.113.7'), '::ffff:203.0.113.7'); // IPv4-mapped stays as is
  assert.equal(ipBucket(undefined), 'unknown');
});
