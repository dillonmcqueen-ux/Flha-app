import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDue, sinceFor, dedupeEmails, digestText, readRecipients } from '../../server-lib/portalReports.js';

const base = { active: true, frequency: 'daily', weekday: null, last_sent_at: null };
// 2026-09-30 is a Wednesday (getUTCDay() === 3)
const wed = new Date('2026-09-30T13:00:00Z');

test('daily is due unless it already went out today (UTC)', () => {
  assert.equal(isDue(base, wed), true);
  assert.equal(isDue({ ...base, last_sent_at: '2026-09-30T01:00:00Z' }, wed), false);
  assert.equal(isDue({ ...base, last_sent_at: '2026-09-29T23:59:00Z' }, wed), true);
});

test('weekly is due only on its weekday', () => {
  assert.equal(isDue({ ...base, frequency: 'weekly', weekday: 3 }, wed), true);
  assert.equal(isDue({ ...base, frequency: 'weekly', weekday: 4 }, wed), false);
  assert.equal(isDue({ ...base, frequency: 'weekly', weekday: 3, last_sent_at: '2026-09-30T02:00:00Z' }, wed), false);
});

test('an inactive schedule is never due', () => {
  assert.equal(isDue({ ...base, active: false }, wed), false);
});

test('window starts at last send, else one period back', () => {
  assert.equal(sinceFor({ ...base, last_sent_at: '2026-09-28T13:00:00Z' }, wed).toISOString(), '2026-09-28T13:00:00.000Z');
  assert.equal(sinceFor(base, wed).toISOString(), '2026-09-29T13:00:00.000Z');
  assert.equal(sinceFor({ ...base, frequency: 'weekly' }, wed).toISOString(), '2026-09-23T13:00:00.000Z');
});

test('dedupeEmails ignores case and blanks', () => {
  assert.deepEqual(dedupeEmails(['A@b.co', 'a@B.co', '', ' c@d.co ']), ['A@b.co', 'c@d.co']);
});

test('digest lists PDF links, caps long lists, and has no em dash', () => {
  const rec = (i) => ({ document_title: 'Pre-Trip', submitted_by: 'Mike', created_at: '2026-09-30T10:00:00Z', pdf_url: i % 2 ? 'https://x/y.pdf' : null });
  const text = digestText({ companyName: 'Acme', scheduleName: 'Daily safety', department: 'safety', records: Array.from({ length: 60 }, (_, i) => rec(i)) });
  assert.match(text, /60 completed documents for Safety \(Daily safety\)/);
  assert.match(text, /PDF: https:\/\/x\/y\.pdf/);
  assert.match(text, /no PDF was saved/);
  assert.match(text, /and 10 more/);
  assert.ok(!text.includes('—'));
});

test('readRecipients survives an unreadable value', () => {
  const orig = console.error; console.error = () => {};
  try {
    assert.deepEqual(readRecipients({ id: 1, recipients_encrypted: 'enc:v1:bad:bad:bad' }), []);
    assert.deepEqual(readRecipients({ id: 2, recipients_encrypted: null }), []);
  } finally { console.error = orig; }
});

// ── runSchedule: a report nobody can receive must not be marked as sent ──
import { runSchedule } from '../../server-lib/portalReports.js';

function fakeDb(tables) {
  const updates = [];
  const db = {
    updates,
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
    from(name) {
      const state = { name, isUpdate: false };
      const b = {
        select: () => b, eq: () => b, in: () => b, gt: () => b, not: () => b, order: () => b, limit: () => b,
        update: (v) => { state.isUpdate = true; updates.push({ table: name, values: v }); return b; },
        then: (res) => res({ data: state.isUpdate ? null : (tables[name] || []), error: null }),
      };
      return b;
    },
  };
  return db;
}

test('runSchedule leaves last_sent_at alone when there is nobody to send to', async () => {
  process.env.RESEND_API_KEY = 'test';
  const db = fakeDb({
    companies: [{ name: 'Acme' }],
    portal_documents: [{ id: 1, title: 'Pre-Trip', departments: ['safety'] }],
    portal_records: [{ id: 9, document_id: 1, submitted_by: 'Mike', created_at: '2026-09-30T10:00:00Z', pdf_url: null }],
    roster: [], // no supervisors with an email
  });
  const r = await runSchedule(db, { id: 5, company_id: 1, name: 'x', department: 'safety', frequency: 'daily', include_department_supervisors: true, recipients_encrypted: null, last_sent_at: null });
  assert.equal(r.recordCount, 1);
  assert.equal(r.sent, 0);
  assert.equal(r.marked, false);
  assert.equal(db.updates.length, 0);
});

test('runSchedule marks a quiet day as handled', async () => {
  process.env.RESEND_API_KEY = 'test';
  const db = fakeDb({ companies: [{ name: 'Acme' }], portal_documents: [], portal_records: [], roster: [] });
  const r = await runSchedule(db, { id: 5, company_id: 1, name: 'x', department: 'safety', frequency: 'daily', include_department_supervisors: true, recipients_encrypted: null, last_sent_at: null });
  assert.equal(r.recordCount, 0);
  assert.equal(r.marked, true);
  assert.equal(db.updates.length, 1);
});

test('runSchedule refuses to run without an email key', async () => {
  delete process.env.RESEND_API_KEY;
  const db = fakeDb({});
  const r = await runSchedule(db, { id: 5, company_id: 1, department: 'safety', frequency: 'daily', last_sent_at: null });
  assert.equal(r.reason, 'email_not_configured');
  assert.equal(db.updates.length, 0);
});
