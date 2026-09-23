// Break #24: the new-hire invite screen offered a ticket upload the server
// refuses.
//
// src/WalletInvite.jsx holds an invite token, not a full session, and never
// asked whether the company has Certification Tracking. So a new hire at a
// company without it filled in a ticket type, name, two dates and picked a
// photo, tapped "Add ticket", and only then learned the plan does not
// include it. Dillon's call (2026-09-23): the invite carries the flag.
//
// redeem_wallet_invite now answers certificationsEnabled: true / false, or
// null when the settings lookup failed. The screen hides the card only on an
// explicit false, so a lookup blip never hides a feature the company paid
// for (the server still refuses the upload either way).

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

// Invite token encodes the company: 'invite-7' belongs to company 7.
// Company 7 has certifications on, 8 has it off, 9 has no row, 10's lookup fails.
const SETTINGS = { 7: true, 8: false };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  await new Promise(r => { req.on('data', () => {}); req.on('end', r); });
  const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
  const eq = key => (url.searchParams.get(key) || '').replace('eq.', '');

  if (table === 'roster') {
    if (req.method === 'PATCH') return send(200, [{ id: 1 }]);
    const companyId = Number(eq('wallet_invite_token').replace('invite-', ''));
    return send(200, [{
      id: 1, name: 'New Hire', email: '', role: 'worker', company_id: companyId, active: true, wallet_enabled: true,
      wallet_invite_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
    }]);
  }
  if (table === 'companies') return send(200, [{ id: Number(eq('id')), name: 'Test Co', app_type: 'safety', suspended: false }]);
  if (table === 'company_document_settings') {
    const companyId = Number(eq('company_id'));
    if (companyId === 10) return send(500, { message: 'connection reset' });
    return send(200, companyId in SETTINGS ? [{ is_active: SETTINGS[companyId] }] : []);
  }
  return send(200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(r => server.close(r)));

const { default: handler } = await import('../../api/login.js');

async function redeem(companyId) {
  const out = { statusCode: null, body: null };
  await handler({ method: 'POST', body: { action: 'redeem_wallet_invite', inviteToken: `invite-${companyId}` }, headers: {} }, {
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
  });
  return out;
}

test('a company WITH Certification Tracking: the invite says so', async () => {
  const out = await redeem(7);
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body.certificationsEnabled, true);
});

test('a company with it switched OFF: the invite says false', async () => {
  const out = await redeem(8);
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body.certificationsEnabled, false);
});

test('a company with NO settings row: false, same deny-by-default as the upload itself', async () => {
  const out = await redeem(9);
  assert.equal(out.body.certificationsEnabled, false);
});

test('a failed lookup answers null, not false, and the invite still redeems', async () => {
  const out = await redeem(10);
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body.certificationsEnabled, null);
});
