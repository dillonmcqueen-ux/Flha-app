// api/scope-approval.js: two simultaneous Approve clicks must not create two
// invoices. The handler claims the row ('sent' -> 'approved') with one
// conditional UPDATE before it calls Stripe; the request that loses the claim
// gets the confirmation page and never reaches Stripe.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.STRIPE_SECRET_KEY ||= 'sk_test_placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

let scopeRow;
let claimWins; // whether the conditional UPDATE changes a row
let patches; // bodies of PATCHes to portal_scope_requests

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  let raw = '';
  await new Promise(r => { req.on('data', c => { raw += c; }); req.on('end', r); });
  const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
  if (table === 'rpc/bump_ip_throttle') return send(200, 1);
  if (table === 'portal_scope_requests' && req.method === 'GET') return send(200, scopeRow);
  if (table === 'portal_scope_requests' && req.method === 'PATCH') {
    patches.push({ body: JSON.parse(raw), query: Object.fromEntries(url.searchParams) });
    return send(200, claimWins ? [{ id: scopeRow.id }] : []);
  }
  return send(200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(r => server.close(r)));

const { default: handler } = await import('../../api/scope-approval.js');

async function post() {
  const out = { statusCode: null, body: null };
  await handler({ method: 'POST', query: { token: 'tok' }, headers: {}, socket: {} }, {
    status(code) { out.statusCode = code; return this; },
    send(payload) { out.body = payload; return this; },
  });
  return out;
}

test.beforeEach(() => {
  scopeRow = { id: 3, status: 'sent', client_name: 'ABC Earthworks Company', setup_fee_cents: 150000, monthly_fee_cents: 0, document_count: 5, doc_band: 'small' };
  claimWins = true;
  patches = [];
});

test('the request that loses the claim shows the confirmation and never reaches Stripe', async () => {
  claimWins = false;
  const out = await post();
  assert.equal(out.statusCode, 200);
  assert.match(out.body, /Approved/);
  assert.equal(patches.length, 1);
});

test('the claim is a conditional UPDATE on status = sent', async () => {
  claimWins = false;
  await post();
  assert.equal(patches[0].body.status, 'approved');
  assert.equal(patches[0].query.status, 'eq.sent');
  assert.equal(patches[0].query.id, 'eq.3');
});

test('a Stripe failure after a won claim hands the claim back', async () => {
  // No network to Stripe in the sandbox, so the first Stripe call throws.
  const out = await post();
  assert.equal(out.statusCode, 500);
  const release = patches.find(p => p.body.status === 'sent');
  assert.ok(release, 'the row goes back to sent');
  assert.equal(release.body.approved_at, null);
  assert.equal(release.query.status, 'eq.approved');
});
