// What happens to a record saved to sign later that nobody signs
// (server-lib/unsignedSweep.js, server-lib/signLater.js):
//   - after 24 hours the people who would be told get ONE heads-up per document
//     type, with no content, and only when the document's Notify switch is on
//   - it is claimed before it is sent, so a second run never repeats it
//   - if nobody could be told because the mail failed, it is retried next run
//   - after 10 days it is closed unsigned, and a closed record can no longer be signed
//   - an anonymous near miss is placed by its site alone
//   - another company's records are never mixed into this company's audience

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { encryptField } from '../../server-lib/fieldCrypto.js';
import { alertOverdueUnsigned, closeStaleUnsigned } from '../../server-lib/unsignedSweep.js';
import { completeSignature, UNSIGNED_CLOSE_MS } from '../../server-lib/signLater.js';

process.env.FIELD_ENCRYPTION_KEY ||= 'a'.repeat(64);
const HOUR = 3600 * 1000;
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const ago = (ms) => new Date(NOW - ms).toISOString();

const P = (over) => ({ company_id: 7, active: true, is_owner: false, is_lead: false, departments: [], divisions: [], default_site_id: null, ...over });
const em = (a) => encryptField(a);
const ROSTER = [
  P({ id: 1, role: 'supervisor', is_owner: true, email: em('owner@x.test') }),
  P({ id: 2, role: 'supervisor', departments: ['safety'], email: em('sam@x.test') }),
  P({ id: 3, role: 'supervisor', default_site_id: 50, email: em('sue@x.test') }),
  P({ id: 11, role: 'worker', departments: ['safety'], email: em('cam@x.test') }),
  P({ id: 91, company_id: 8, role: 'supervisor', departments: ['safety'], email: em('other@x.test') }),
];
let TABLES, NOTIFY, SUSPENDED = [], NO_CLOSED_COLUMN = false;
const reset = () => {
  SUSPENDED = []; NO_CLOSED_COLUMN = false;
  NOTIFY = [{ company_id: 7, document_key: 'incident', enabled: true, extra_roster_ids: [] }, { company_id: 7, document_key: 'nearmiss', enabled: true, extra_roster_ids: [] }];
  TABLES = {
    incidents: [
      { id: 1, company_id: 7, site_id: null, submitted_by_roster_id: 11, awaiting_signature: true, signature_requested_at: ago(30 * HOUR), unsigned_alerted_at: null, unsigned_closed_at: null },
      { id: 2, company_id: 7, site_id: null, submitted_by_roster_id: 11, awaiting_signature: true, signature_requested_at: ago(30 * HOUR), unsigned_alerted_at: null, unsigned_closed_at: null },
      { id: 3, company_id: 7, site_id: null, submitted_by_roster_id: 11, awaiting_signature: true, signature_requested_at: ago(2 * HOUR), unsigned_alerted_at: null, unsigned_closed_at: null },
      { id: 4, company_id: 7, site_id: null, submitted_by_roster_id: 11, awaiting_signature: false, signature_requested_at: ago(40 * HOUR), unsigned_alerted_at: null, unsigned_closed_at: null },
    ],
    near_misses: [], flhas: [], inspections: [],
  };
};
reset();

const num = (v) => (v && v.startsWith('eq.') ? v.slice(3) : null);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const table = url.pathname.replace('/rest/v1/', '');
  const body = await new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => r(b)); });
  const payload = body ? JSON.parse(body) : null;
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const p = (k) => url.searchParams.get(k);
  const match = (r) => {
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      if (v.startsWith('eq.')) { if (String(r[k]) !== v.slice(3)) return false; }
      else if (v === 'is.null') { if (r[k] != null) return false; }
      else if (v === 'not.is.null') { if (r[k] == null) return false; }
      else if (v.startsWith('lt.')) { if (!(r[k] && new Date(r[k]) < new Date(v.slice(3)))) return false; }
      else if (v.startsWith('in.')) { if (!v.slice(4, -1).split(',').includes(String(r[k]))) return false; }
    }
    return true;
  };
  if (table === 'roster') return send(200, ROSTER.filter(match));
  if (table === 'companies') return send(200, [7, 8].map((id) => ({ id, suspended: SUSPENDED.includes(id) })).filter(match));
  if (table === 'document_notifications') return send(200, NOTIFY.filter(match));
  if (table === 'sites') return send(200, [{ id: 50, company_id: 7, division_id: null }].filter(match));
  if (TABLES[table]) {
    if (NO_CLOSED_COLUMN && req.method === 'GET' && (p('select') || '').includes('unsigned_closed_at')) return send(400, { code: '42703', message: 'column does not exist' });
    const hits = TABLES[table].filter(match);
    if (req.method === 'PATCH') { hits.forEach((r) => Object.assign(r, payload)); return send(200, hits.map((r) => ({ id: r.id }))); }
    return send(200, hits.slice(0, Number(p('limit')) || 1000));
  }
  return send(200, []);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const supabase = createClient(`http://127.0.0.1:${server.address().port}`, 'test-key', { auth: { persistSession: false } });
test.after(() => new Promise((r) => server.close(r)));

const mail = () => { const sent = []; return { sent, sendEmail: async (m) => { sent.push(m); } }; };

test('after 24 hours the audience gets ONE heads-up per document type, with no content', async () => {
  reset();
  const { sent, sendEmail } = mail();
  const out = await alertOverdueUnsigned(supabase, { sendEmail, nowMs: NOW });
  assert.equal(out.alerted, 2, 'only the two records unsigned for over a day');
  assert.deepEqual(sent.map((m) => m.to), ['sam@x.test'], 'the safety supervisor, once; the Owner is only a fallback');
  assert.equal(sent[0].subject, '2 Incident Reports still unsigned');
  assert.ok(!/cam|11|worker name/i.test(sent[0].text));
  assert.ok(!sent.some((m) => m.to === 'other@x.test'), 'another company is never told');
  assert.ok(!sent.some((m) => m.to === 'cam@x.test'), 'the author is never told');
});

test('a record is alerted once: the next run sends nothing', async () => {
  reset();
  await alertOverdueUnsigned(supabase, { sendEmail: mail().sendEmail, nowMs: NOW });
  const { sent, sendEmail } = mail();
  const again = await alertOverdueUnsigned(supabase, { sendEmail, nowMs: NOW + HOUR });
  assert.equal(again.alerted, 0);
  assert.equal(sent.length, 0);
});

test('nothing is sent when the document\'s Notify switch is off', async () => {
  reset(); NOTIFY = [];
  const { sent, sendEmail } = mail();
  await alertOverdueUnsigned(supabase, { sendEmail, nowMs: NOW });
  assert.equal(sent.length, 0);
});

test('if every send fails, the record goes back in the queue and is retried', async () => {
  reset();
  const failing = async () => { throw new Error('Resend API error: 500'); };
  const first = await alertOverdueUnsigned(supabase, { sendEmail: failing, nowMs: NOW });
  assert.ok(first.failed > 0);
  assert.equal(TABLES.incidents[0].unsigned_alerted_at, null, 'claim handed back');
  const { sent, sendEmail } = mail();
  await alertOverdueUnsigned(supabase, { sendEmail, nowMs: NOW + HOUR });
  assert.ok(sent.length > 0, 'told on the retry');
});

test('an anonymous near miss is placed by its site alone', async () => {
  reset(); TABLES.incidents = [];
  TABLES.near_misses = [{ id: 9, company_id: 7, site_id: 50, is_anonymous: true, submitted_by_roster_id: 11, awaiting_signature: true, signature_requested_at: ago(30 * HOUR), unsigned_alerted_at: null, unsigned_closed_at: null }];
  const { sent, sendEmail } = mail();
  await alertOverdueUnsigned(supabase, { sendEmail, nowMs: NOW });
  assert.deepEqual(sent.map((m) => m.to), ['sue@x.test'], 'the site supervisor only, not the author\'s department');
});

test('after 10 days a record is closed unsigned, a younger one is not, and never before its heads-up stage', async () => {
  reset();
  TABLES.incidents[0].signature_requested_at = ago(UNSIGNED_CLOSE_MS + HOUR);
  assert.equal(await closeStaleUnsigned(supabase, { nowMs: NOW }), 0, 'not looked at by the heads-up stage yet, so not closed in silence');
  TABLES.incidents[0].unsigned_alerted_at = ago(HOUR);
  const closed = await closeStaleUnsigned(supabase, { nowMs: NOW });
  assert.equal(closed, 1);
  assert.ok(TABLES.incidents[0].unsigned_closed_at);
  assert.equal(TABLES.incidents[1].unsigned_closed_at, null);
  assert.equal(TABLES.incidents[0].awaiting_signature, true, 'stays out of everything that counts only signed records');
});

test('a closed record can no longer be signed', async () => {
  reset();
  TABLES.incidents[0].unsigned_closed_at = ago(HOUR);
  const out = await completeSignature(supabase, { table: 'incidents', id: 1, session: { userId: 11, companyId: 7 }, update: { worker_signature: 'x' }, nowIso: new Date(NOW).toISOString() });
  assert.equal(out.denied.status, 409);
  assert.match(out.denied.error, /closed unsigned/);
  assert.equal(TABLES.incidents[0].awaiting_signature, true);
  const open = await completeSignature(supabase, { table: 'incidents', id: 2, session: { userId: 11, companyId: 7 }, update: { worker_signature: 'x' }, nowIso: new Date(NOW).toISOString() });
  assert.equal(open.ok, true, 'an open record still signs');
});

test('overdue records of a suspended company cannot hold up everyone else', async () => {
  reset(); SUSPENDED = [8];
  TABLES.incidents = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, company_id: 8, site_id: null, submitted_by_roster_id: null, awaiting_signature: true, signature_requested_at: ago(60 * HOUR), unsigned_alerted_at: null, unsigned_closed_at: null }))
    .concat([{ id: 1, company_id: 7, site_id: null, submitted_by_roster_id: 11, awaiting_signature: true, signature_requested_at: ago(30 * HOUR), unsigned_alerted_at: null, unsigned_closed_at: null }]);
  const { sent, sendEmail } = mail();
  await alertOverdueUnsigned(supabase, { sendEmail, nowMs: NOW });
  assert.deepEqual(sent.map((m) => m.to), ['sam@x.test'], 'company 7 is told even though 12 older records belong to a suspended company');
  assert.ok(sent.every((m) => m.to !== 'other@x.test'));
});

test('a database missing only the newer column still knows which records are unsigned', async () => {
  reset(); NO_CLOSED_COLUMN = true;
  const out = await completeSignature(supabase, { table: 'incidents', id: 4, session: { userId: 11, companyId: 7 }, update: {}, nowIso: new Date(NOW).toISOString() });
  assert.equal(out.denied.status, 409, 'record 4 is already signed, so a second signature is refused');
  const { loadSignState } = await import('../../server-lib/signLater.js');
  const state = await loadSignState(supabase, 'incidents', 1, 7);
  assert.equal(state.awaiting, true, 'record 1 is still seen as awaiting a signature, not as signed');
});

test('a bad address does not keep a record at the head of the queue', async () => {
  reset();
  const rejecting = async () => { throw new Error('Resend API error: 422 invalid address'); };
  await alertOverdueUnsigned(supabase, { sendEmail: rejecting, nowMs: NOW });
  assert.ok(TABLES.incidents[0].unsigned_alerted_at, 'a permanent rejection will not be retried');
});

test('many records from one author are routed once and mailed once per person', async () => {
  reset();
  TABLES.incidents = Array.from({ length: 30 }, (_, i) => ({ id: 200 + i, company_id: 7, site_id: null, submitted_by_roster_id: 11, awaiting_signature: true, signature_requested_at: ago(30 * HOUR), unsigned_alerted_at: null, unsigned_closed_at: null }));
  const { sent, sendEmail } = mail();
  await alertOverdueUnsigned(supabase, { sendEmail, nowMs: NOW });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, '30 Incident Reports still unsigned');
});

test('a record closed unsigned does not keep the review backlog from ever being caught up', async () => {
  const { reviewBacklog } = await import('../../src/analyticsUtils.js');
  const nm = [{ id: 1, reviewed: true }, { id: 2, reviewed: false, awaiting_signature: true, unsigned_closed_at: '2026-10-01T00:00:00Z' }];
  const out = reviewBacklog(nm, []);
  assert.equal(out.caughtUp, true);
  assert.equal(out.outstanding, 0);
  assert.equal(out.closedUnsigned, 1);
});
