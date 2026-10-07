// Notification routing (server-lib/notifyRouting.js), PR 1: the audience rule
// on its own, before any handler calls it.
//   - off by default: no setting, a disabled setting, or a database without the
//     table notifies nobody
//   - the audience is who could open the record: supervisors by department,
//     division or site, a crew lead only for their own crew's records
//   - the Owner hears only when nobody else would, extras are added on top
//   - the author is never told; an anonymous record is placed by site alone
//   - nobody from another company is ever reached
//   - the email names the document and site only, one email per person

process.env.FIELD_ENCRYPTION_KEY ||= 'a'.repeat(64);

import test from 'node:test';
import assert from 'node:assert/strict';
import { pickRecipients, routeNotification, notifyOnSubmit, MAX_RECIPIENTS } from '../../server-lib/notifyRouting.js';
import { encryptField } from '../../server-lib/fieldCrypto.js';

const P = (over) => ({ active: true, is_owner: false, is_lead: false, departments: [], divisions: [], default_site_id: null, email: null, ...over });
const ROSTER = [
  P({ id: 1, role: 'supervisor', is_owner: true, email: 'owner@x.test' }),
  P({ id: 2, role: 'supervisor', departments: ['safety'], email: 'sam@x.test' }),
  P({ id: 3, role: 'supervisor', default_site_id: 50, email: 'pit@x.test' }),
  P({ id: 4, role: 'supervisor', divisions: [9], email: 'civil@x.test' }),
  P({ id: 5, role: 'supervisor', departments: ['safety'], email: null }),
  P({ id: 10, role: 'worker', is_lead: true, departments: ['safety'], email: 'lee@x.test' }),
  P({ id: 11, role: 'worker', departments: ['safety'], email: 'cam@x.test' }),
  P({ id: 12, role: 'worker', departments: ['yard'], email: 'oz@x.test' }),
  P({ id: 13, role: 'worker', departments: ['safety'], email: 'nat@x.test' }),
];
const DIVISION_SITES = new Map([[9, [60]]]);
const author = (id) => ROSTER.find((p) => p.id === id);
const ids = (out) => out.recipients.map((r) => r.id).sort((a, b) => a - b);

test('supervisors are reached by department, site or division, the Owner is not', () => {
  const byDept = pickRecipients({ record: { site_id: null, submitted_by_roster_id: 11 }, roster: ROSTER, author: author(11), divisionSites: DIVISION_SITES });
  assert.deepEqual(ids(byDept), [2, 10], 'safety supervisor with an email, plus the safety lead; id 5 has no email');
  assert.deepEqual(byDept.missingEmail, [5]);

  const bySite = pickRecipients({ record: { site_id: 50, submitted_by_roster_id: 12 }, roster: ROSTER, author: author(12), divisionSites: DIVISION_SITES });
  assert.deepEqual(ids(bySite), [3]);

  const byDivisionSite = pickRecipients({ record: { site_id: 60, submitted_by_roster_id: 12 }, roster: ROSTER, author: author(12), divisionSites: DIVISION_SITES });
  assert.deepEqual(ids(byDivisionSite), [4], 'a site in the supervisor\'s division places the record');
});

test('a crew lead hears only about their own crew, never anonymous or other crews', () => {
  const crew = pickRecipients({ record: { site_id: null, submitted_by_roster_id: 13 }, roster: ROSTER, author: author(13), divisionSites: DIVISION_SITES });
  assert.ok(ids(crew).includes(10));
  const otherCrew = pickRecipients({ record: { site_id: null, submitted_by_roster_id: 12 }, roster: ROSTER, author: author(12), divisionSites: DIVISION_SITES });
  assert.ok(!ids(otherCrew).includes(10), 'yard author is not on the safety lead\'s crew');
  const anonymous = pickRecipients({ record: { site_id: 50, submitted_by_roster_id: null }, roster: ROSTER, author: null, divisionSites: DIVISION_SITES });
  assert.ok(!ids(anonymous).includes(10), 'no author, no lead');
  assert.deepEqual(ids(anonymous), [3], 'placed by its site alone');
});

test('the author is never told about their own submission', () => {
  const out = pickRecipients({ record: { site_id: null, submitted_by_roster_id: 2 }, roster: ROSTER, author: author(2), divisionSites: DIVISION_SITES });
  assert.ok(!ids(out).includes(2));
});

test('the Owner is the fallback only, and only when nobody else would be told', () => {
  const nobody = pickRecipients({ record: { site_id: 999, submitted_by_roster_id: 12 }, roster: ROSTER, author: author(12), divisionSites: DIVISION_SITES });
  assert.deepEqual(ids(nobody), [1], 'yard worker, unknown site: only the Owner');
  const ownerFiles = pickRecipients({ record: { site_id: 999, submitted_by_roster_id: 1 }, roster: ROSTER, author: author(1), divisionSites: DIVISION_SITES });
  assert.equal(ownerFiles.recipients.length, 0, 'the Owner is the author, so nobody is told');
  assert.equal(ownerFiles.reason, 'none');
});

test('extras are added on top, and must be active people in the roster', () => {
  const out = pickRecipients({ record: { site_id: null, submitted_by_roster_id: 11 }, roster: ROSTER, author: author(11), divisionSites: DIVISION_SITES, extraRosterIds: [12, 777, '4'] });
  assert.deepEqual(ids(out), [2, 4, 10, 12], '777 is not in this company roster and is ignored');
});

test('an inactive author is still placed by their department', () => {
  const retired = { id: 20, departments: ['safety'], divisions: [], default_site_id: null };
  const out = pickRecipients({ record: { site_id: null, submitted_by_roster_id: 20 }, roster: ROSTER, author: retired, divisionSites: DIVISION_SITES });
  assert.ok(ids(out).includes(2));
});

test('the audience is capped', () => {
  const crowd = Array.from({ length: 60 }, (_, i) => P({ id: 100 + i, role: 'supervisor', departments: ['safety'], email: `s${i}@x.test` }));
  const out = pickRecipients({ record: { site_id: null, submitted_by_roster_id: null }, roster: [P({ id: 1, role: 'supervisor', is_owner: true, email: 'o@x.test' }), ...crowd], author: null, divisionSites: new Map(), extraRosterIds: crowd.map((p) => p.id) });
  assert.equal(out.recipients.length, MAX_RECIPIENTS);
});

// ── the loader, behind a stand-in database ──────────────────────────────
function fakeDb(tables, { failTable = null, failCode = '42P01' } = {}) {
  return {
    from(name) {
      const filters = [];
      let limitN = null;
      const builder = {
        select() { return builder; },
        eq(k, v) { filters.push((r) => String(r[k]) === String(v)); return builder; },
        in(k, vs) { filters.push((r) => vs.map(String).includes(String(r[k]))); return builder; },
        limit(n) { limitN = n; return builder; },
        then(resolve) {
          if (failTable === name) return resolve({ data: null, error: { code: failCode, message: 'x' } });
          let rows = (tables[name] || []).filter((r) => filters.every((f) => f(r)));
          if (limitN != null) rows = rows.slice(0, limitN);
          return resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  };
}
const enc = (rows) => rows.map((r) => ({ ...r, email: r.email ? encryptField(r.email) : null }));
const company7 = enc(ROSTER.map((p) => ({ ...p, company_id: 7 })));
const company8 = enc([P({ id: 90, role: 'supervisor', departments: ['safety'], email: 'other@y.test', company_id: 8 })]);
const baseTables = (setting) => ({
  document_notifications: setting ? [{ company_id: 7, document_key: 'incident', ...setting }] : [],
  roster: [...company7, ...company8],
  sites: [{ id: 60, company_id: 7, division_id: 9 }],
});
const rec = { site_id: null, submitted_by_roster_id: 11 };

test('off by default: no row, a disabled row, or a missing table notify nobody', async () => {
  for (const [label, db] of [
    ['no row', fakeDb(baseTables(null))],
    ['disabled', fakeDb(baseTables({ enabled: false, extra_roster_ids: [] }))],
    ['table missing', fakeDb(baseTables({ enabled: true }), { failTable: 'document_notifications' })],
  ]) {
    const out = await routeNotification(db, { companyId: 7, documentKey: 'incident', record: rec });
    assert.equal(out.recipients.length, 0, label);
    assert.equal(out.enabled, false, label);
  }
});

test('enabled: the loader decrypts emails and never reaches another company', async () => {
  const db = fakeDb(baseTables({ enabled: true, extra_roster_ids: [90] }));
  const out = await routeNotification(db, { companyId: 7, documentKey: 'incident', record: rec });
  assert.equal(out.enabled, true);
  assert.deepEqual(ids(out), [2, 10]);
  assert.ok(!out.recipients.some((r) => r.email === 'other@y.test'), 'company 8 person named as an extra is ignored');
  assert.deepEqual(out.recipients.map((r) => r.email).sort(), ['lee@x.test', 'sam@x.test']);
});

test('notifyOnSubmit: one email per person, no report content, never throws', async () => {
  const sent = [];
  const db = fakeDb(baseTables({ enabled: true, extra_roster_ids: [] }));
  const out = await notifyOnSubmit(db, { sendEmail: async (m) => { sent.push(m); }, companyId: 7, documentKey: 'incident', record: rec, siteName: 'Hwy 2 Pit' });
  assert.equal(out.sent, 2);
  assert.equal(sent.length, 2);
  for (const m of sent) {
    assert.equal(typeof m.to, 'string', 'one address per email, never a shared list');
    assert.equal(m.subject, 'New Incident Report at Hwy 2 Pit');
    assert.ok(!/\u2014/.test(m.text));
  }

  const failing = await notifyOnSubmit(db, { sendEmail: async () => { throw new Error('boom'); }, companyId: 7, documentKey: 'incident', record: rec });
  assert.equal(failing.failed, 2);
  assert.equal(failing.sent, 0);

  const broken = await notifyOnSubmit({ from() { throw new Error('db down'); } }, { sendEmail: async () => {}, companyId: 7, documentKey: 'incident', record: rec });
  assert.equal(broken.reason, 'error');
});
