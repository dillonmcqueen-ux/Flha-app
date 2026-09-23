// Break #25: a custom document switched off still opened and still accepted
// submissions.
//
// The worker menu hides a custom form whose `custom_<id>` setting is false
// (api/customforms.js get_worker_documents), but get_active_form and
// submit_custom never read company_document_settings, so a saved URL or a
// stale tab kept working. submit_custom did not check custom_forms.is_active
// either, so a form a supervisor toggled off took submissions the same way.
//
// The two defaults are deliberately OPPOSITE to the built-in gate and must
// stay that way (tests/unit/doc-setting-defaults.test.js): a custom form
// with NO settings row is ON. Only an explicit false switches it off.
//
// A refusal is 403, which tells the offline queue to drop the entry and show
// the worker why (Dillon, 2026-09-23: "refuse and tell them"). A FAILED
// settings lookup is 503, so a database blip never drops queued work.

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

// Form 50: active, no settings row (the normal case, must stay ON).
// Form 51: active, switched off in the Admin Panel (custom_51 = false).
// Form 52: toggled off by the supervisor (custom_forms.is_active = false).
// Form 53: its settings lookup fails.
const FORMS = {
  50: { id: 50, company_id: 7, is_active: true, title: 'Crane Lift Plan' },
  51: { id: 51, company_id: 7, is_active: true, title: 'Hot Work Permit' },
  52: { id: 52, company_id: 7, is_active: false, title: 'Old Checklist' },
  53: { id: 53, company_id: 7, is_active: true, title: 'Confined Space' },
};
const SETTINGS = { custom_51: false };

const calls = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  await new Promise(r => { req.on('data', () => {}); req.on('end', r); });
  calls.push({ method: req.method, table });
  const send = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
  const eq = key => (url.searchParams.get(key) || '').replace('eq.', '');

  if (table === 'company_document_settings') {
    const key = eq('document_key');
    if (key === 'custom_53') return send(500, { message: 'connection reset' });
    return send(200, key in SETTINGS ? [{ is_active: SETTINGS[key] }] : []);
  }
  if (table === 'sites') return send(200, [{ id: Number(eq('id')), company_id: 7 }]);
  if (table === 'custom_forms') { const f = FORMS[eq('id')]; return send(200, f ? [f] : []); }
  if (table === 'companies') return send(200, [{ suspended: false }]);
  if (table === 'custom_form_records' && req.method === 'POST') return send(201, { id: 900 });
  return send(200, []);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
test.after(() => new Promise(r => server.close(r)));

const { default: handler } = await import('../../api/customforms.js');

async function call(body) {
  const out = { statusCode: null, body: null };
  await handler({ method: 'POST', body }, {
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
  });
  return out;
}

const worker = mintToken({ role: 'worker', companyId: 7 });
const open = formId => call({ action: 'get_active_form', token: worker, siteId: 1, formId });
const submit = formId => call({ action: 'submit_custom', token: worker, siteId: 1, formId, answers: [], submittedBy: 'R. Chen' });
const recordInserts = () => calls.filter(c => c.table === 'custom_form_records' && c.method === 'POST').length;

test('a custom form with NO settings row still opens (allow-by-default, on purpose)', async () => {
  const out = await open(50);
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
});

test('a custom form with NO settings row still accepts a submission', async () => {
  const out = await submit(50);
  assert.notEqual(out.statusCode, 403, JSON.stringify(out.body));
});

test('a custom form switched off in the Admin Panel does not open', async () => {
  const out = await open(51);
  assert.equal(out.statusCode, 403, JSON.stringify(out.body));
  assert.match(out.body.error, /switched off/);
});

test('a custom form switched off in the Admin Panel refuses a submission and writes nothing', async () => {
  const before = recordInserts();
  const out = await submit(51);
  assert.equal(out.statusCode, 403, JSON.stringify(out.body));
  assert.equal(recordInserts(), before, 'no record may be written');
});

test('a form the supervisor toggled off refuses a submission too', async () => {
  const before = recordInserts();
  const out = await submit(52);
  assert.equal(out.statusCode, 403, JSON.stringify(out.body));
  assert.equal(recordInserts(), before);
});

test('a failed settings lookup is 503, never 403, so queued work is kept', async () => {
  const opened = await open(53);
  assert.equal(opened.statusCode, 503, JSON.stringify(opened.body));
  const submitted = await submit(53);
  assert.equal(submitted.statusCode, 503, JSON.stringify(submitted.body));
});
