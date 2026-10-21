// Rules for Send & Sign (server-lib/sentDocuments.js): input validation, who
// a supervisor may send to, and the derived "overdue" status.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET ||= 'test-session-secret';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';

const { normalizeSendInput, senderMayTarget, displayStatus, canCancel, handleSentDocument } =
  await import('../../server-lib/sentDocuments.js');
const { createUploadUrl } = await import('../../server-lib/uploadUrls.js');

const base = { title: 'Winter driving', category: 'training', mode: 'sign', rosterIds: [3, 4], receipt: 'r.s' };

test('normalizeSendInput accepts a complete request and de-duplicates people', () => {
  const { value } = normalizeSendInput({ ...base, rosterIds: [3, '3', 4], dueAt: '2026-11-01' });
  assert.deepEqual(value.rosterIds, [3, 4]);
  assert.equal(value.mode, 'sign');
  assert.equal(value.dueAt, '2026-11-01T00:00:00.000Z');
});

test('normalizeSendInput rejects each missing piece', () => {
  for (const patch of [
    { title: '  ' }, { category: 'memes' }, { mode: 'fax' },
    { rosterIds: [] }, { rosterIds: ['x'] }, { receipt: '' }, { dueAt: 'soon' },
  ]) {
    assert.ok(normalizeSendInput({ ...base, ...patch }).error, JSON.stringify(patch));
  }
});

test('normalizeSendInput caps the recipient list', () => {
  const many = Array.from({ length: 101 }, (_, i) => i + 1);
  assert.ok(normalizeSendInput({ ...base, rosterIds: many }).error);
});

const supervisor = {
  bypass: false, rosterId: 10, departments: ['safety'], divisionIds: [2], siteIds: new Set([7]),
};

test('senderMayTarget: Owner and founder reach everyone', () => {
  assert.equal(senderMayTarget({ bypass: true }, { id: 99 }), true);
});

test('senderMayTarget: a supervisor reaches shared department, division, site, or self', () => {
  assert.equal(senderMayTarget(supervisor, { id: 1, departments: ['safety'] }), true);
  assert.equal(senderMayTarget(supervisor, { id: 1, divisions: ['2'] }), true);
  assert.equal(senderMayTarget(supervisor, { id: 1, default_site_id: 7 }), true);
  assert.equal(senderMayTarget(supervisor, { id: 10 }), true);
});

test('senderMayTarget: a supervisor cannot reach someone outside their tags', () => {
  assert.equal(senderMayTarget(supervisor, { id: 1, departments: ['hr'], divisions: [5], default_site_id: 9 }), false);
  assert.equal(senderMayTarget(supervisor, { id: 1 }), false);
  assert.equal(senderMayTarget(null, { id: 1 }), false);
});

test('displayStatus derives overdue and never overrides a finished document', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  assert.equal(displayStatus({ status: 'sent', due_at: '2026-11-01T00:00:00Z' }, now), 'overdue');
  assert.equal(displayStatus({ status: 'opened', due_at: '2026-11-20T00:00:00Z' }, now), 'opened');
  assert.equal(displayStatus({ status: 'sent', due_at: null }, now), 'sent');
  assert.equal(displayStatus({ status: 'completed', due_at: '2026-11-01T00:00:00Z' }, now), 'completed');
  assert.equal(displayStatus({ status: 'cancelled', due_at: '2026-11-01T00:00:00Z' }, now), 'cancelled');
});

test('canCancel only before the document is finished', () => {
  assert.equal(canCancel({ status: 'sent' }), true);
  assert.equal(canCancel({ status: 'opened' }), true);
  assert.equal(canCancel({ status: 'completed' }), false);
  assert.equal(canCancel({ status: 'cancelled' }), false);
});

// ── send_document against a fake database ──────────────────────────────

function fakeSupabase({ rosterRows, inserted }) {
  const chain = (rows) => {
    const q = { filters: {} };
    q.select = () => q;
    q.eq = (k, v) => { q.filters[k] = v; return q; };
    q.in = () => q;
    q.limit = () => Promise.resolve({ data: rows, error: null });
    q.then = (resolve) => resolve({ data: rows, error: null });
    return q;
  };
  return {
    from(table) {
      if (table === 'roster') return chain(rosterRows);
      if (table === 'sent_documents') {
        return { insert(rows) { inserted.push(...rows); return { select: () => Promise.resolve({ data: rows.map((_, i) => ({ id: i + 1 })), error: null }) }; } };
      }
      throw new Error(`unexpected table ${table}`);
    },
    storage: { from: () => ({ createSignedUploadUrl: (path) => Promise.resolve({ data: { path, token: 't' }, error: null }) }) },
  };
}

test('send_document writes one row per person, stamped with the verified path', async () => {
  const supa = fakeSupabase({ rosterRows: [], inserted: [] });
  const { receipt, path } = await createUploadUrl(supa, 'sent-documents', 'originals/a.pdf', 5);
  const inserted = [];
  const db = fakeSupabase({
    inserted,
    rosterRows: [{ id: 3, name: 'A', departments: [], divisions: [], default_site_id: null }, { id: 4, name: 'B', departments: [], divisions: [], default_site_id: null }],
  });
  const founder = { role: 'admin' };
  const out = await handleSentDocument({
    supabase: db, session: founder, companyId: 5, action: 'send_document',
    body: { ...base, receipt },
  });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(out.body.sent, 2);
  assert.deepEqual(inserted.map((r) => r.roster_id), [3, 4]);
  assert.ok(inserted.every((r) => r.original_path === path && r.company_id === 5 && r.batch_id === out.body.batchId));
});

test('send_document refuses a receipt issued for another company', async () => {
  const supa = fakeSupabase({ rosterRows: [], inserted: [] });
  const { receipt } = await createUploadUrl(supa, 'sent-documents', 'originals/a.pdf', 9);
  const inserted = [];
  const out = await handleSentDocument({
    supabase: fakeSupabase({ rosterRows: [], inserted }), session: { role: 'admin' }, companyId: 5,
    action: 'send_document', body: { ...base, receipt },
  });
  assert.equal(out.status, 400);
  assert.equal(inserted.length, 0);
});

test('send_document refuses the whole send when someone is missing or out of scope', async () => {
  const supa = fakeSupabase({ rosterRows: [], inserted: [] });
  const { receipt } = await createUploadUrl(supa, 'sent-documents', 'originals/a.pdf', 5);
  const inserted = [];
  const out = await handleSentDocument({
    // Person 4 is not returned: wrong company or inactive.
    supabase: fakeSupabase({ inserted, rosterRows: [{ id: 3, name: 'A' }] }),
    session: { role: 'admin' }, companyId: 5, action: 'send_document', body: { ...base, receipt },
  });
  assert.equal(out.status, 403);
  assert.equal(inserted.length, 0);
});

test('a worker cannot send, upload or cancel', async () => {
  const worker = { role: 'worker', userId: 3, companyId: 5 };
  const db = fakeSupabase({ inserted: [], rosterRows: [{ id: 3, role: 'worker', is_owner: false, departments: [], divisions: [], default_site_id: null, company_id: 5 }] });
  for (const action of ['create_sent_document_upload_url', 'send_document', 'cancel_sent_document']) {
    const out = await handleSentDocument({ supabase: db, session: worker, companyId: 5, action, body: { ...base, id: 1, filename: 'a.pdf' } });
    assert.equal(out.status, 403, action);
  }
});

test('a company id that is not a plain positive integer is refused', async () => {
  const db = fakeSupabase({ inserted: [], rosterRows: [] });
  for (const bad of ['5/../9', '0', -1, '1e3', null, undefined, '5 ']) {
    const out = await handleSentDocument({ supabase: db, session: { role: 'admin' }, companyId: bad, action: 'create_sent_document_upload_url', body: { filename: 'a.pdf' } });
    assert.equal(out.status, 400, String(bad));
  }
});

test('list_sendable_people returns only the people the sender may reach', async () => {
  const rows = [
    { id: 1, name: 'Same dept', role: 'worker', departments: ['safety'], divisions: [], default_site_id: null },
    { id: 2, name: 'Other dept', role: 'worker', departments: ['hr'], divisions: [], default_site_id: null },
  ];
  const db = {
    from(table) {
      const q = {};
      q.select = () => q; q.eq = () => q; q.neq = () => q;
      q.order = () => Promise.resolve({ data: table === 'roster' ? rows : [], error: null });
      q.in = () => q;
      q.limit = () => Promise.resolve({
        data: [{ id: 10, role: 'supervisor', is_owner: false, departments: ['safety'], divisions: [], default_site_id: null, company_id: 5 }],
        error: null,
      });
      return q;
    },
  };
  const out = await handleSentDocument({
    supabase: db, session: { role: 'supervisor', userId: 10, companyId: 5 }, companyId: 5,
    action: 'list_sendable_people', body: {},
  });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(out.body.people.map((p) => p.id), [1]);
});

test('Send & Sign is a standalone, priced module with its own document key', async () => {
  const { MODULES, quote, ALL_DOC_KEYS, resolveModules } = await import('../../server-lib/pricing.js');
  assert.deepEqual(MODULES.sendsign.docKeys, ['sent_documents']);
  assert.deepEqual(MODULES.sendsign.price, { basic: 20, advanced: 45 });
  assert.equal(MODULES.sendsign.requires, undefined);
  assert.ok(ALL_DOC_KEYS.includes('sent_documents'));
  assert.deepEqual(resolveModules('sendsign').modules, ['sendsign']);
  assert.equal(quote('basic', ['sendsign']).monthly, 80);
  assert.equal(quote('advanced', ['sendsign']).monthly, 185);
});
