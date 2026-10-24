// The public onboarding form emails a confirmation to whatever address the
// form's author typed, from FORA's verified domain. It must not be a relay:
//   - the company name is reduced to plain text (no links, no line breaks);
//   - one address gets at most a few of them a day, whatever IP asks.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.ADMIN_CODE = 'a-long-admin-code-123456';
process.env.RESEND_API_KEY = 'test-resend-key';

let throttleCount;
let paidCheckout; // whether the claimed Stripe checkout session exists
let seenKeys; // p_key of every bump_ip_throttle call
const sent = []; // bodies sent to Resend

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  let raw = '';
  await new Promise(r => { req.on('data', c => { raw += c; }); req.on('end', r); });
  const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
  if (table === 'rpc/bump_ip_throttle') { seenKeys.push(JSON.parse(raw).p_key); return send(200, throttleCount(JSON.parse(raw).p_key)); }
  if (table === 'stripe_checkouts') return send(200, paidCheckout ? [{ customer_id: 'cus_test', plan_tier: 'basic', modules: null }] : []);
  if (table === 'onboarding_requests' && req.method === 'POST') return send(201, [{ id: 7 }]);
  return send(200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(r => server.close(r)));

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.resend.com/')) {
    const body = JSON.parse(init.body);
    if (body.to !== 'forafieldsolutions@gmail.com') sent.push(body);
    return new Response('{}', { status: 200 });
  }
  return realFetch(url, init);
};

const { default: handler } = await import('../../api/login.js');
const { safeDisplayName } = await import('../../server-lib/onboardingHelpers.js');

async function submit(overrides = {}) {
  const out = { statusCode: null, body: null };
  await handler({
    method: 'POST', headers: {},
    body: {
      action: 'submit_onboarding_intake',
      companyName: 'ABC Earthworks Company', contactEmail: 'owner@abc.example', stripeSessionId: 'cs_test_1',
      sitesList: 'Yard', usersList: 'Jamie Worker, worker', ...overrides,
    },
  }, {
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
  });
  return out;
}

test.beforeEach(() => {
  throttleCount = () => 1;
  paidCheckout = true;
  seenKeys = [];
  sent.length = 0;
});

test('the confirmation email carries a plain-text company name only', async () => {
  const out = await submit({ companyName: 'Win a prize http://evil.example/claim\nCall now' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].subject + sent[0].text.split('\n')[0], /evil|http|\n/);
  assert.match(sent[0].subject, /Win a prize Call now/);
});

test('an address that has used its daily confirmations gets no more', async () => {
  throttleCount = (key) => (key.startsWith('onbmail:') ? 4 : 1);
  const out = await submit();
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.ok(seenKeys.some(k => k.startsWith('onbmail:')));
  assert.equal(sent.length, 0);
});

test('the throttle key is a hash, never the address', async () => {
  await submit();
  const key = seenKeys.find(k => k.startsWith('onbmail:'));
  assert.ok(key);
  assert.doesNotMatch(key, /owner|abc\.example|@/);
});

test('safeDisplayName strips links, markup, line breaks and length', () => {
  assert.equal(safeDisplayName('ABC Earthworks Ltd.'), 'ABC Earthworks Ltd.');
  assert.equal(safeDisplayName('Hi http://evil.example/x there'), 'Hi there');
  assert.equal(safeDisplayName('www.evil.example Co'), 'Co');
  assert.equal(safeDisplayName('Mail bob@evil.example now'), 'Mail now');
  assert.equal(safeDisplayName('<b>Co</b>'), 'b Co /b');
  assert.equal(safeDisplayName(''), 'your company');
  assert.equal(safeDisplayName(null), 'your company');
  assert.equal(safeDisplayName('x'.repeat(500)).length, 80);
});

test('no verified purchase means no confirmation email', async () => {
  paidCheckout = false;
  const out = await submit();
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body.confirmationEmailed, false);
  assert.equal(sent.length, 0);
  assert.ok(out.body.editToken, 'the edit link is still handed back for the page to show');
});

test('a verified purchase gets the email and the response says so', async () => {
  const out = await submit();
  assert.equal(out.body.confirmationEmailed, true);
  assert.equal(sent.length, 1);
});
