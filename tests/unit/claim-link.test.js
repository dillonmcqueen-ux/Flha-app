// Onboarding claim link (api/login.js: claim_*). The link is a bearer token
// that works for 14 days, so what it can do has to stay narrow:
//   - it never overwrites a PIN the person chose through their own setup link;
//   - every claim action spends a per-IP budget;
//   - the equipment and policy confirmations refuse oversized lists.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.ADMIN_CODE = 'a-long-admin-code-123456';

let throttleCount;
let rosterRow;
let seen; // { method, table }
let claimedAt; // onboarding_requests.claimed_at
let patchMatches; // whether the guarded UPDATE finds a row

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  let raw = '';
  await new Promise(r => { req.on('data', c => { raw += c; }); req.on('end', r); });
  seen.push({ method: req.method, table });
  const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
  if (table === 'rpc/bump_ip_throttle') return send(200, throttleCount);
  if (table === 'onboarding_requests') {
    return send(200, [{ id: 5, created_company_id: 1, claim_token: 'tok', claim_token_expires_at: new Date(Date.now() + 3600e3).toISOString(), draft_status: 'done', claimed_at: claimedAt }]);
  }
  if (table === 'roster') return send(200, req.method === 'GET' ? [rosterRow] : (rosterRow.pin_set_at || !patchMatches ? [] : [{ id: rosterRow.id }]));
  return send(200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(r => server.close(r)));

const { default: handler } = await import('../../api/login.js');

async function call(body) {
  const out = { statusCode: null, body: null };
  await handler({ method: 'POST', body, headers: {} }, {
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
  });
  return out;
}

test.beforeEach(() => {
  throttleCount = 1;
  rosterRow = { id: 11, company_id: 1, pin_set_at: null, active: true, role: 'worker' };
  seen = [];
  patchMatches = true;
  claimedAt = null;
});

const writes = (table) => seen.filter(r => r.table === table && r.method !== 'GET');
const setPin = () => call({ action: 'claim_set_roster_pin', claimToken: 'tok', rosterId: 11, pin: '493817' });

test('a PIN nobody has set yet can be assigned through the link', async () => {
  const out = await setPin();
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(writes('roster').length, 1);
});

test('a PIN the person set through their own setup link is left alone', async () => {
  rosterRow.pin_set_at = '2026-10-01T00:00:00Z';
  const out = await setPin();
  assert.equal(out.statusCode, 409);
  assert.equal(writes('roster').length, 0);
});

test('a spent per-IP budget refuses every claim action', async () => {
  throttleCount = 9999;
  assert.equal((await setPin()).statusCode, 429);
  assert.equal((await call({ action: 'claim_get_details', claimToken: 'tok' })).statusCode, 429);
  assert.equal((await call({ action: 'claim_finalize', claimToken: 'tok' })).statusCode, 429);
  assert.equal(writes('roster').length, 0);
  assert.equal(writes('onboarding_requests').length, 0);
});

test('oversized equipment and policy lists are refused before any insert', async () => {
  const items = Array.from({ length: 201 }, () => ({ make: 'CAT' }));
  const eq = await call({ action: 'claim_confirm_equipment', claimToken: 'tok', items });
  assert.equal(eq.statusCode, 400);
  const longField = await call({ action: 'claim_confirm_equipment', claimToken: 'tok', items: [{ make: 'x'.repeat(201) }] });
  assert.equal(longField.statusCode, 400);

  const policies = Array.from({ length: 201 }, () => 'Wear a hard hat.');
  assert.equal((await call({ action: 'claim_confirm_sops', claimToken: 'tok', policies })).statusCode, 400);
  assert.equal((await call({ action: 'claim_confirm_sops', claimToken: 'tok', policies: ['y'.repeat(5001)] })).statusCode, 400);

  assert.equal(writes('equipment').length + writes('sops').length, 0);
});

test('a normal confirmation still goes through', async () => {
  const out = await call({ action: 'claim_confirm_equipment', claimToken: 'tok', items: [{ make: 'CAT', model: '320', type: 'Excavator' }] });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body.added, 1);
});

test('a deactivated person or an auditor is not assigned a PIN', async () => {
  rosterRow.active = false;
  assert.equal((await setPin()).statusCode, 404);
  rosterRow = { id: 11, company_id: 1, pin_set_at: null, active: true, role: 'auditor' };
  assert.equal((await setPin()).statusCode, 404);
  assert.equal(writes('roster').length, 0);
});

test('a setup link finished between the read and the write wins', async () => {
  // The read saw no PIN; by the time the guarded UPDATE runs the person has
  // set their own, so it matches no row and the claim link must not report success.
  patchMatches = false;
  const out = await setPin();
  assert.equal(out.statusCode, 409);
});

test('once the contact finishes, the link is dead for every action', async () => {
  claimedAt = '2026-10-24T20:00:00Z';
  for (const body of [
    { action: 'claim_get_details' },
    { action: 'claim_set_roster_pin', rosterId: 11, pin: '493817' },
    { action: 'claim_confirm_equipment', items: [{ make: 'CAT' }] },
    { action: 'claim_confirm_sops', policies: ['Wear a hard hat.'] },
    { action: 'claim_finalize' },
  ]) {
    const out = await call({ claimToken: 'tok', ...body });
    assert.equal(out.statusCode, 400, body.action);
    assert.match(out.body.error, /already been used/, body.action);
  }
  assert.equal(writes('roster').length + writes('equipment').length + writes('sops').length + writes('onboarding_requests').length, 0);
});
