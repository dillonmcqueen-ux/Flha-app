// The held-notice digest (server-lib/notifyDigest.js) and its cron endpoint.
//   - a person whose window ended and who holds notices gets ONE email with the count
//   - rows are dropped, not retried, when the document is switched off, the person is
//     inactive or has no usable address, or their company is suspended
//   - a send that fails is refunded so the next run tries again
//   - another company's roster row with the same id is never used
//   - the cron endpoint refuses a caller without CRON_SECRET and returns counts only

process.env.FIELD_ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.CRON_SECRET = 'test-cron-secret';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

import test from 'node:test';
import assert from 'node:assert/strict';
import { runDigest, isPermanentRejection, DIGEST_BATCH } from '../../server-lib/notifyDigest.js';
import { encryptField } from '../../server-lib/fieldCrypto.js';

function fakeDb({ held = [], settings = [], roster = [], companies = [], forms = [], docSettings = [{ company_id: 7, document_key: 'incident', is_active: true }], failClaim = false, failLookup = false } = {}) {
  const refunds = [];
  const table = (rows) => ({
    cur: rows,
    select() { return this; },
    in(k, vs) { this.cur = this.cur.filter((r) => vs.map(String).includes(String(r[k]))); return this; },
    limit() { return this; },
    then(resolve) { return resolve(failLookup ? { data: null, error: { code: 'X', message: 'x' } } : { data: this.cur, error: null }); },
  });
  return {
    refunds,
    rpc(name, args) {
      if (name === 'claim_held_notices') return Promise.resolve(failClaim ? { data: null, error: { code: '42883', message: 'missing' } } : { data: held, error: null });
      if (name === 'refund_notification_slot') { refunds.push(args); return Promise.resolve({ data: null, error: null }); }
      throw new Error('unexpected rpc ' + name);
    },
    from(name) {
      if (name === 'document_notifications') return table(settings);
      if (name === 'roster') return table(roster);
      if (name === 'companies') return table(companies);
      if (name === 'custom_forms') return table(forms);
      if (name === 'company_document_settings') return table(docSettings);
      throw new Error('unexpected table ' + name);
    },
  };
}
const person = (id, company, over = {}) => ({ id, company_id: company, active: true, email: encryptField(`p${id}@x.test`), ...over });
const row = (roster, over = {}) => ({ company_id: 7, document_key: 'incident', roster_id: roster, held: 3, ...over });
const base = (over = {}) => ({
  held: [row(1)], settings: [{ company_id: 7, document_key: 'incident', enabled: true }],
  roster: [person(1, 7)], companies: [{ id: 7, suspended: false }], ...over,
});
const collect = () => { const sent = []; return { sent, sendEmail: async (m) => { sent.push(m); } }; };

test('one email per person with the count, no report content', async () => {
  const { sent, sendEmail } = collect();
  const out = await runDigest(fakeDb(base()), { sendEmail });
  assert.equal(out.sent, 1);
  assert.equal(sent[0].to, 'p1@x.test');
  assert.equal(sent[0].subject, 'Incident Report: 3 new');
  assert.match(sent[0].text, /3 more Incident Reports were submitted since your last notice/);
});

test('a company\'s own document is named after its form, never another company\'s form', async () => {
  const { sent, sendEmail } = collect();
  const out = await runDigest(fakeDb(base({
    held: [row(1, { document_key: 'custom_5' })],
    settings: [{ company_id: 7, document_key: 'custom_5', enabled: true }],
    forms: [{ id: 5, company_id: 7, title: 'Hot Work Permit', is_active: true }, { id: 5, company_id: 8, title: 'Other Co Form', is_active: true }],
  })), { sendEmail });
  assert.equal(out.sent, 1);
  assert.equal(sent[0].subject, 'Hot Work Permit: 3 new');
});

test('a document the company has since switched off is not announced, and its count is dropped', async () => {
  const run = async (over) => {
    const { sent, sendEmail } = collect();
    const out = await runDigest(fakeDb(base(over)), { sendEmail });
    return { sent, out };
  };
  const off = await run({ docSettings: [{ company_id: 7, document_key: 'incident', is_active: false }] });
  assert.equal(off.sent.length, 0, 'built-in switched off');
  assert.equal(off.out.dropped, 1);
  const never = await run({ docSettings: [] });
  assert.equal(never.sent.length, 0, 'a built-in with no active row was never offered');
  const customRow = { held: [row(1, { document_key: 'custom_5' })], settings: [{ company_id: 7, document_key: 'custom_5', enabled: true }] };
  const inactiveForm = await run({ ...customRow, forms: [{ id: 5, company_id: 7, title: 'Hot Work Permit', is_active: false }] });
  assert.equal(inactiveForm.sent.length, 0, 'custom form made inactive');
  const switchedOff = await run({ ...customRow, forms: [{ id: 5, company_id: 7, title: 'Hot Work Permit', is_active: true }], docSettings: [{ company_id: 7, document_key: 'custom_5', is_active: false }] });
  assert.equal(switchedOff.sent.length, 0, 'custom form switched off in settings');
  const gone = await run({ ...customRow, forms: [] });
  assert.equal(gone.sent.length, 0, 'custom form deleted');
});

test('if the document lookups fail, nothing is lost and nothing is sent', async () => {
  const db = fakeDb(base({ failLookup: true }));
  const { sent, sendEmail } = collect();
  const out = await runDigest(db, { sendEmail });
  assert.equal(out.error, true);
  assert.equal(sent.length, 0);
  assert.ok(db.refunds.length > 0);
});

test('singular wording and the 999 cap', async () => {
  const { sent, sendEmail } = collect();
  await runDigest(fakeDb(base({ held: [row(1, { held: 1 })] })), { sendEmail });
  assert.match(sent[0].text, /^1 more Incident Report was submitted/);
  const two = collect();
  await runDigest(fakeDb(base({ held: [row(1, { held: 999 })] })), { sendEmail: two.sendEmail });
  assert.equal(two.sent[0].subject, 'Incident Report: 999+ new');
});

test('nothing to do is quiet', async () => {
  const { sent, sendEmail } = collect();
  const out = await runDigest(fakeDb(base({ held: [] })), { sendEmail });
  assert.deepEqual([out.claimed, out.sent, out.error], [0, 0, false]);
  assert.equal(sent.length, 0);
});

test('rows that cannot be told are dropped, not retried', async () => {
  const { sent, sendEmail } = collect();
  const db = fakeDb({
    held: [row(1, { document_key: 'nearmiss' }), row(2), row(3), row(4), row(5, { company_id: 8 })],
    settings: [{ company_id: 7, document_key: 'incident', enabled: true }, { company_id: 8, document_key: 'incident', enabled: true }],
    roster: [person(1, 7), person(2, 7, { active: false }), person(3, 7, { email: null }), person(4, 7, { email: encryptField('a@x.test, b@y.test') }), person(5, 7)],
    companies: [{ id: 7, suspended: false }, { id: 8, suspended: true }],
  });
  const out = await runDigest(db, { sendEmail });
  assert.equal(sent.length, 0);
  assert.equal(out.dropped, 5, 'switched off, inactive, no address, a list of addresses, suspended company / wrong company roster');
  assert.equal(db.refunds.length, 0);
});

test('a roster row of another company with the same id is never used', async () => {
  const { sent, sendEmail } = collect();
  const db = fakeDb(base({ roster: [person(1, 8)] }));
  const out = await runDigest(db, { sendEmail });
  assert.equal(sent.length, 0);
  assert.equal(out.dropped, 1);
});

test('a failed send is refunded so the next run tries again', async () => {
  const db = fakeDb(base({ held: [row(1), row(2)], roster: [person(1, 7), person(2, 7)] }));
  let n = 0;
  const out = await runDigest(db, { sendEmail: async () => { n += 1; if (n === 1) throw new Error('boom'); } });
  assert.equal(out.sent, 1);
  assert.equal(out.failed, 1);
  assert.equal(db.refunds.length, 1);
  assert.deepEqual([db.refunds[0].p_slots, db.refunds[0].p_held], [0, 3], 'held count returned, no slot to return');
});

test('if the claim or the lookups fail, nothing is lost and nothing is sent', async () => {
  const { sent, sendEmail } = collect();
  const noClaim = await runDigest(fakeDb(base({ failClaim: true })), { sendEmail });
  assert.equal(noClaim.error, true);
  const db = fakeDb(base({ failLookup: true }));
  const noLookup = await runDigest(db, { sendEmail });
  assert.equal(noLookup.error, true);
  assert.equal(db.refunds.length, 1, 'the claimed count is handed back');
  assert.equal(sent.length, 0);
});

test('the cron endpoint refuses a caller without the secret', async () => {
  const { default: handler } = await import('../../api/cron-notification-digest.js');
  const res = () => { const o = { code: null, body: null }; return { o, status(c) { o.code = c; return this; }, json(b) { o.body = b; return this; } }; };
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'test-cron-secret' }]) {
    const r = res();
    await handler({ method: 'GET', headers }, r);
    assert.equal(r.o.code, 401, JSON.stringify(headers));
  }
});

test('permanent rejections are recognised', () => {
  assert.equal(isPermanentRejection(new Error('Resend API error: 422 {"message":"invalid"}')), true);
  assert.equal(isPermanentRejection(new Error('Resend API error: 403 forbidden')), true);
  assert.equal(isPermanentRejection(new Error('Resend API error: 429 slow down')), false, 'rate limit retries');
  assert.equal(isPermanentRejection(new Error('Resend API error: 408 timeout')), false);
  assert.equal(isPermanentRejection(new Error('Resend API error: 500 oops')), false);
  assert.equal(isPermanentRejection(new Error('socket hang up')), false);
});

test('a permanent rejection is dropped, a temporary one is refunded, so a bad address cannot starve the queue', async () => {
  const dropDb = fakeDb(base());
  const dropped = await runDigest(dropDb, { sendEmail: async () => { throw new Error('Resend API error: 422 bad address'); } });
  assert.equal(dropped.dropped, 1);
  assert.equal(dropped.failed, 0);
  assert.equal(dropDb.refunds.length, 0, 'not retried');

  const retryDb = fakeDb(base());
  const retried = await runDigest(retryDb, { sendEmail: async () => { throw new Error('Resend API error: 429 slow'); } });
  assert.equal(retried.failed, 1);
  assert.equal(retryDb.refunds.length, 1, 'retried next run');
});

test('a stored address that cannot be decrypted is handed back, not dropped', async () => {
  // Valid ciphertext shape under a different key cannot be decrypted with the current one.
  const prevKey = process.env.FIELD_ENCRYPTION_KEY;
  process.env.FIELD_ENCRYPTION_KEY = 'b'.repeat(64);
  const foreign = encryptField('p1@x.test');
  process.env.FIELD_ENCRYPTION_KEY = prevKey;
  const db = fakeDb(base({ roster: [{ id: 1, company_id: 7, active: true, email: foreign }] }));
  const { sent, sendEmail } = collect();
  const out = await runDigest(db, { sendEmail });
  assert.equal(sent.length, 0);
  assert.equal(out.dropped, 0, 'a key problem is not a person who cannot be told');
  assert.equal(out.failed, 1);
  assert.equal(db.refunds.length, 1);
});

test('the batch is small enough that a cut-off run loses little', () => {
  assert.ok(DIGEST_BATCH <= 50);
});

test('the cron endpoint does not claim anything when the mail key or encryption key is missing', async () => {
  const { default: handler } = await import('../../api/cron-notification-digest.js');
  const call = async () => {
    const o = { code: null, body: null };
    await handler({ method: 'GET', headers: { authorization: 'Bearer test-cron-secret' } }, { status(c) { o.code = c; return this; }, json(b) { o.body = b; return this; } });
    return o;
  };
  const prev = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const noMail = await call();
  assert.deepEqual([noMail.code, noMail.body], [200, { skipped: true }]);
  process.env.RESEND_API_KEY = 'x';
  const prevKey = process.env.FIELD_ENCRYPTION_KEY;
  process.env.FIELD_ENCRYPTION_KEY = 'too-short';
  const badKey = await call();
  assert.deepEqual([badKey.code, badKey.body], [200, { skipped: true }]);
  process.env.FIELD_ENCRYPTION_KEY = prevKey;
  if (prev === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prev;
});
