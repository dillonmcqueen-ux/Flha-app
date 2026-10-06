// The emailed set-your-own-PIN link (server-lib/setupLinks.js, and
// api/login.js's pin_link_open / pin_link_set_pin).
//
// What has to hold:
//   - a link only works while its jti hash is the one on the row (single use,
//     replaced by a newer link, cleared by a PIN or email change);
//   - opening it proves the mailbox, so it may finish an authenticator setup,
//     but it never replaces an authenticator that already exists;
//   - whoever needs an authenticator gets NO session from it, only an enroll
//     ticket, and that ticket is not a session anywhere in api/;
//   - a forged, wrong-purpose or expired ticket is refused.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.SESSION_SECRET = 'test-session-secret-for-signing-only';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.FIELD_ENCRYPTION_KEY ??= crypto.randomBytes(32).toString('base64');

let row; // the roster row the fake database returns
let patchResult; // what the consuming UPDATE returns
let patches; // every UPDATE the handler sent, in order
const pinPatch = () => patches.find(p => p && 'pin_hash' in p) || null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  let raw = '';
  await new Promise(r => { req.on('data', c => { raw += c; }); req.on('end', r); });
  const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };

  if (table === 'roster') {
    if (req.method === 'PATCH') { patches.push(raw ? JSON.parse(raw) : null); return send(200, patchResult); }
    return send(200, [row]);
  }
  if (table === 'companies') return send(200, [{ id: 7, name: 'Test Co', suspended: false }]);
  if (table === 'company_document_settings') return send(200, [{ is_active: true }]);
  return send(200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(r => server.close(r)));

const { default: handler } = await import('../../api/login.js');
const { hashJti, signPinLinkTicket, verifyPinLinkTicket, pinSetupEmail, pinLinkTtlMs, PIN_LINK_TTL_MS, PIN_LINK_MFA_TTL_MS } = await import('../../server-lib/setupLinks.js');

const JTI = 'the-live-jti';
const ticket = (over = {}) => signPinLinkTicket({ rosterId: 1, companyId: 7, jti: JTI, ...over });

function freshRow(over = {}) {
  return {
    id: 1, company_id: 7, name: 'New Hire', role: 'worker', active: true, email: null,
    departments: [], totp_enabled: false, is_owner: false,
    pin_link_jti_hash: hashJti(JTI),
    pin_link_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

async function call(body) {
  const out = { statusCode: null, body: null };
  await handler({ method: 'POST', body, headers: {} }, {
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
  });
  return out;
}
const setPin = (extra = {}, linkToken = ticket()) => call({ action: 'pin_link_set_pin', linkToken, pin: '482913', ...extra });

test.beforeEach(() => { row = freshRow(); patchResult = [{ id: 1 }]; patches = []; });

test('a worker who needs no authenticator is signed in as soon as the PIN is saved', async () => {
  const out = await setPin();
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body.stage, 'session');
  assert.equal(out.body.session.userId, 1);
  assert.equal(out.body.session.role, 'worker');
  assert.ok(out.body.token);
  // The consuming update clears the link and records that they chose a PIN.
  assert.equal(pinPatch().pin_link_jti_hash, null);
  assert.ok(pinPatch().pin_set_at);
  assert.notEqual(pinPatch().pin_hash, '482913'); // hashed, never stored as typed
});

test('a supervisor gets an enroll ticket and NO session', async () => {
  row = freshRow({ role: 'supervisor', email: 'enc-ignored' });
  const out = await setPin({ email: 'boss@example.com' });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body.stage, 'enroll');
  assert.ok(out.body.enrollTicket);
  assert.equal(out.body.session, undefined);
  assert.equal(out.body.token, undefined);
  const payload = JSON.parse(Buffer.from(out.body.enrollTicket.split('.')[0], 'base64url').toString());
  assert.equal(payload.purpose, 'mfa_enroll'); // carries purpose, so no verifySession accepts it
  assert.equal(payload.rosterId, 1);
  // The enroll link is armed on the row in the same statement that used the PIN link.
  assert.equal(pinPatch().mfa_setup_jti_hash, hashJti(payload.jti));
});

test('someone in a sensitive department is treated like a supervisor', async () => {
  row = freshRow({ departments: ['payroll'] });
  const out = await setPin({ email: 'pay@example.com' });
  assert.equal(out.body.stage, 'enroll');
});

test('someone who must enroll but has no email on file has to give one', async () => {
  row = freshRow({ role: 'supervisor', email: null });
  const out = await setPin();
  assert.equal(out.statusCode, 400);
  assert.match(out.body.error, /email/i);
  assert.equal(pinPatch(), null); // nothing was written
});

test('a link never replaces an authenticator that already exists', async () => {
  row = freshRow({ role: 'supervisor', totp_enabled: true });
  const out = await setPin();
  assert.equal(out.statusCode, 200);
  assert.equal(out.body.stage, 'signin');
  assert.equal(out.body.token, undefined);
  assert.equal(out.body.session, undefined);
});

test('a used, replaced or cleared link is refused', async () => {
  row = freshRow({ pin_link_jti_hash: null });
  assert.equal((await setPin()).statusCode, 400);
  row = freshRow({ pin_link_jti_hash: hashJti('a-newer-link') });
  assert.equal((await setPin()).statusCode, 400);
});

test('two parallel submits: the one whose UPDATE matches no row loses', async () => {
  patchResult = []; // the other request already cleared the hash
  const out = await setPin();
  assert.equal(out.statusCode, 400);
  assert.match(out.body.error, /already used/i);
  assert.equal(out.body.token, undefined);
});

test('an expired row, an inactive person and a bad PIN are refused', async () => {
  row = freshRow({ pin_link_expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await setPin()).statusCode, 400);
  row = freshRow({ active: false });
  assert.equal((await setPin()).statusCode, 403);
  row = freshRow();
  assert.equal((await setPin({ pin: '1234' })).statusCode, 400);
  assert.equal((await setPin({ pin: 'abcdef' })).statusCode, 400);
});

test('an email is only taken from the page when none is on file, and must be valid', async () => {
  const bad = await setPin({ email: 'not-an-email' });
  assert.equal(bad.statusCode, 400);
});

test('opening the link reveals no secret, and only a masked address', async () => {
  row = freshRow();
  const out = await call({ action: 'pin_link_open', linkToken: ticket() });
  assert.equal(out.statusCode, 200);
  assert.deepEqual(Object.keys(out.body).sort(), ['companyName', 'emailHint', 'emailOnFile', 'hasAuthenticator', 'mfaRequired', 'name']);
  assert.equal(out.body.emailOnFile, false);
});

test('tickets: tampered, wrong purpose and expired ones do not verify', () => {
  const good = ticket();
  assert.ok(verifyPinLinkTicket(good));
  const [data, sig] = good.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data, 'base64url').toString()), rosterId: 2 })).toString('base64url');
  assert.equal(verifyPinLinkTicket(`${forged}.${sig}`), null);
  assert.equal(verifyPinLinkTicket('garbage'), null);
  assert.equal(verifyPinLinkTicket(undefined), null);

  const signRaw = (payload) => {
    const d = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${d}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(d).digest('base64url')}`;
  };
  // Correctly signed, but not a pin_setup ticket: an authenticator ticket or a session must not pass.
  assert.equal(verifyPinLinkTicket(signRaw({ purpose: 'mfa_enroll', jti: 'x', rosterId: 1, companyId: 7, issuedAt: Date.now() })), null);
  assert.equal(verifyPinLinkTicket(signRaw({ role: 'worker', companyId: 7, userId: 1, issuedAt: Date.now() })), null);
  // Correctly signed but older than the 7 day lifetime.
  assert.equal(verifyPinLinkTicket(signRaw({ purpose: 'pin_setup', jti: 'x', rosterId: 1, companyId: 7, issuedAt: Date.now() - PIN_LINK_TTL_MS - 1000 })), null);
});

test('a pin_setup ticket is refused as a session by the other endpoints', async () => {
  // Every verifySession in api/ rejects a payload carrying `purpose`. Pin it
  // for the one endpoint the wallet page talks to.
  const { default: certifications } = await import('../../api/certifications.js');
  const out = { statusCode: null, body: null };
  await certifications({ method: 'POST', body: { action: 'set_own_pin', token: ticket(), pin: '482913' }, headers: {} }, {
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
  });
  assert.ok(out.statusCode === 401 || out.statusCode === 403, `got ${out.statusCode}`);
});

test('the email carries the link and never a PIN, and says what comes next', () => {
  const plain = pinSetupEmail({ name: 'Jo', companyName: 'Acme', url: 'https://x/wallet?token=t', needsAuthenticator: false });
  const strong = pinSetupEmail({ name: 'Jo', companyName: 'Acme', url: 'https://x/wallet?token=t', needsAuthenticator: true });
  assert.ok(plain.text.includes('https://x/wallet?token=t'));
  assert.ok(!plain.text.includes('—'));
  assert.ok(!/authenticator/i.test(plain.text));
  assert.ok(/authenticator/i.test(strong.text));
});

test('typed names cannot turn the email into a long or multi-line message', () => {
  const e = pinSetupEmail({ name: 'Jo\r\nBcc: x@y.com', companyName: 'A'.repeat(300), url: 'https://x/wallet?token=t', needsAuthenticator: false });
  assert.ok(!/Hi Jo\r?\n/.test(e.text));
  assert.ok(e.subject.length < 140);
  assert.ok(!e.subject.includes('\n'));
});

test('lifetime: 24 hours for anyone who must use an authenticator, 7 days for the rest', () => {
  assert.equal(pinLinkTtlMs({ role: 'supervisor', departments: [] }), PIN_LINK_MFA_TTL_MS);
  assert.equal(pinLinkTtlMs({ role: 'worker', is_owner: true, departments: [] }), PIN_LINK_MFA_TTL_MS);
  assert.equal(pinLinkTtlMs({ role: 'worker', departments: ['hr'] }), PIN_LINK_MFA_TTL_MS);
  assert.equal(pinLinkTtlMs({ role: 'worker', departments: ['maintenance'] }), PIN_LINK_TTL_MS);
  assert.equal(PIN_LINK_MFA_TTL_MS, 24 * 60 * 60 * 1000);
});

test('the email states the lifetime that applies', () => {
  const short = pinSetupEmail({ name: 'Jo', companyName: 'Acme', url: 'u', needsAuthenticator: true, ttlMs: PIN_LINK_MFA_TTL_MS });
  const long = pinSetupEmail({ name: 'Jo', companyName: 'Acme', url: 'u', needsAuthenticator: false, ttlMs: PIN_LINK_TTL_MS });
  assert.match(short.text, /24 hours/);
  assert.match(long.text, /7 days/);
});

test('a 7 day link held by someone who now needs an authenticator is refused after 24 hours', async () => {
  // Promoted to supervisor after a long link went out: judged on who they are now.
  row = freshRow({ role: 'supervisor', email: 'enc-ignored' });
  const old = signPinLinkTicket({ rosterId: 1, companyId: 7, jti: JTI });
  const payload = JSON.parse(Buffer.from(old.split('.')[0], 'base64url').toString());
  payload.issuedAt = Date.now() - 25 * 60 * 60 * 1000;
  const d = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const aged = `${d}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(d).digest('base64url')}`;
  const out = await setPin({}, aged);
  assert.equal(out.statusCode, 400);
  assert.match(out.body.error, /expired/i);
  assert.equal(pinPatch(), null);
  // The same age is fine for a plain worker.
  row = freshRow();
  assert.equal((await setPin({}, aged)).statusCode, 200);
});
