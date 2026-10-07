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
import { pickRecipients, routeNotification, notifyOnSubmit, cleanLabel, MAX_RECIPIENTS, COOLDOWN_SECONDS, BURST_LIMIT } from '../../server-lib/notifyRouting.js';
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
// Stand-in for the database function claim_notification_slot, with the same
// rules as the SQL: first claim opens a window, claims inside it are allowed up
// to the burst, then held and counted; a new window reports the held count.
// JavaScript runs one call at a time, so this proves the application's use of
// the claim, not the database's locking, which is checked against the real
// function separately.
function claimRpc(tables, clock, args, failRpc) {
  if (failRpc) return { data: null, error: { code: '42883', message: 'function does not exist' } };
  const list = (tables.document_notification_state = tables.document_notification_state || []);
  const key = (r) => r.company_id === args.p_company && r.document_key === args.p_key && r.roster_id === args.p_roster;
  let r = list.find(key);
  if (!r) {
    list.push({ company_id: args.p_company, document_key: args.p_key, roster_id: args.p_roster, window_started_at: clock.now, sent_in_window: 1, suppressed_count: 0 });
    return { data: [{ allowed: true, suppressed: 0 }], error: null };
  }
  if (clock.now - r.window_started_at >= args.p_window_seconds * 1000) {
    const held = r.suppressed_count;
    Object.assign(r, { window_started_at: clock.now, sent_in_window: 1, suppressed_count: 0 });
    return { data: [{ allowed: true, suppressed: held }], error: null };
  }
  if (r.sent_in_window < args.p_burst) { r.sent_in_window += 1; return { data: [{ allowed: true, suppressed: 0 }], error: null }; }
  r.suppressed_count = Math.min(r.suppressed_count + 1, 999);
  return { data: [{ allowed: false, suppressed: 0 }], error: null };
}

function fakeDb(tables, { failTable = null, failCode = '42P01', failRpc = false, clock = { now: Date.parse('2026-10-07T12:00:00Z') } } = {}) {
  return {
    rpc(name, args) {
      assert.equal(name, 'claim_notification_slot');
      return Promise.resolve(claimRpc(tables, clock, args, failRpc));
    },
    from(name) {
      const filters = [];
      let limitN = null;
      const builder = {
        select() { return builder; },
        eq(k, v) { filters.push((r) => String(r[k]) === String(v)); return builder; },
        in(k, vs) { filters.push((r) => vs.map(String).includes(String(r[k]))); return builder; },
        limit(n) { limitN = n; return builder; },
        upsert(row, opts) {
          const keys = String((opts && opts.onConflict) || 'id').split(',');
          const list = (tables[name] = tables[name] || []);
          const hit = list.find((r) => keys.every((k) => String(r[k]) === String(row[k])));
          if (failTable === name) return { then: (resolve) => resolve({ error: { code: failCode, message: 'x' } }) };
          if (hit) Object.assign(hit, row); else list.push({ ...row });
          return { then: (resolve) => resolve({ error: null }) };
        },
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
  document_assignments: [],
  document_notification_state: [],
  roster: [...company7, ...company8],
  sites: [{ id: 60, company_id: 7, division_id: 9 }, { id: 50, company_id: 7, division_id: null }, { id: 51, company_id: 8, division_id: null }],
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

  const failing = await notifyOnSubmit(fakeDb(baseTables({ enabled: true, extra_roster_ids: [] })), { sendEmail: async () => { throw new Error('boom'); }, companyId: 7, documentKey: 'incident', record: rec });
  assert.equal(failing.failed, 2);
  assert.equal(failing.sent, 0);

  const broken = await notifyOnSubmit({ from() { throw new Error('db down'); } }, { sendEmail: async () => {}, companyId: 7, documentKey: 'incident', record: rec });
  assert.equal(broken.reason, 'error');
});

// ── review fixes ────────────────────────────────────────────────────────
const NOW = Date.parse('2026-10-07T12:00:00Z');
const viewRow = (type, value) => ({ audience_type: type, audience_value: value, action: 'view', restricts: true, created_at: '2026-10-01T00:00:00Z', ended_at: null });

test('a document restricted by view rows is not announced to people it leaves out', () => {
  // Only the safety department may read this document.
  const rows = [viewRow('department', 'safety')];
  const out = pickRecipients({ record: { site_id: 50, submitted_by_roster_id: 12 }, roster: ROSTER, author: author(12), divisionSites: DIVISION_SITES, viewRows: rows, nowMs: NOW });
  assert.ok(!ids(out).includes(3), 'site supervisor 3 has no safety tag, so a site match is not enough');
  assert.deepEqual(ids(out), [1], 'nobody left: the Owner is the fallback and is never restricted');

  const safetyRecord = pickRecipients({ record: { site_id: null, submitted_by_roster_id: 11 }, roster: ROSTER, author: author(11), divisionSites: DIVISION_SITES, viewRows: rows, nowMs: NOW });
  assert.deepEqual(ids(safetyRecord), [2, 10], 'safety people still hear');
});

test('naming someone as an extra cannot widen who may learn about a document', () => {
  const rows = [viewRow('department', 'safety')];
  const out = pickRecipients({ record: { site_id: null, submitted_by_roster_id: 11 }, roster: ROSTER, author: author(11), divisionSites: DIVISION_SITES, extraRosterIds: [12], viewRows: rows, nowMs: NOW });
  assert.ok(!ids(out).includes(12), 'yard worker 12 holds no view right, so the extra is ignored');
});

test('an ended or future view row does not restrict', () => {
  const ended = { ...viewRow('department', 'safety'), ended_at: '2026-10-02T00:00:00Z' };
  const out = pickRecipients({ record: { site_id: 50, submitted_by_roster_id: 12 }, roster: ROSTER, author: author(12), divisionSites: DIVISION_SITES, viewRows: [ended], nowMs: NOW });
  assert.deepEqual(ids(out), [3]);
});

test('extras survive the cap before the broad audience does', () => {
  const crowd = Array.from({ length: 40 }, (_, i) => P({ id: 100 + i, role: 'supervisor', departments: ['safety'], email: `s${i}@x.test` }));
  const named = P({ id: 500, role: 'worker', email: 'named@x.test' });
  const out = pickRecipients({ record: { site_id: null, submitted_by_roster_id: 11 }, roster: [P({ id: 1, role: 'supervisor', is_owner: true, email: 'o@x.test' }), named, ...crowd], author: { id: 11, departments: ['safety'], divisions: [], default_site_id: null }, divisionSites: new Map(), extraRosterIds: [500] });
  assert.equal(out.recipients.length, MAX_RECIPIENTS);
  assert.ok(ids(out).includes(500), 'the person the Owner named is kept');
});

test('only a single plain address is ever used', () => {
  const messy = [
    P({ id: 1, role: 'supervisor', is_owner: true, email: 'o@x.test' }),
    P({ id: 2, role: 'supervisor', departments: ['safety'], email: 'a@x.test, b@y.test' }),
    P({ id: 3, role: 'supervisor', departments: ['safety'], email: 'not an address' }),
    P({ id: 4, role: 'supervisor', departments: ['safety'], email: '  ok@x.test  ' }),
  ];
  const out = pickRecipients({ record: { site_id: null, submitted_by_roster_id: 11 }, roster: messy, author: { id: 11, departments: ['safety'], divisions: [], default_site_id: null }, divisionSites: new Map() });
  assert.deepEqual(out.recipients.map((r) => r.email), ['ok@x.test']);
  assert.deepEqual(out.missingEmail.sort(), [2, 3]);
});

test('labels cannot carry line breaks or links into an email from FORA', () => {
  assert.equal(cleanLabel('Pit\nYour session expired, log in at https://evil.example/x now'), 'Pit Your session expired, log in at now');
  assert.equal(cleanLabel('www.evil.example Yard'), 'Yard');
  assert.equal(cleanLabel(null), '');
  assert.equal(cleanLabel('x'.repeat(200)).length, 80);
});

test('a forged site id from another company does not steer routing', async () => {
  const db = fakeDb(baseTables({ enabled: true, extra_roster_ids: [] }));
  // Site 51 belongs to company 8. Treated as no site, so only the author's tags route.
  const forged = await routeNotification(db, { companyId: 7, documentKey: 'incident', record: { site_id: 51, submitted_by_roster_id: 12 } });
  assert.ok(!forged.recipients.some((r) => r.email === 'pit@x.test'));
  const own = await routeNotification(db, { companyId: 7, documentKey: 'incident', record: { site_id: 50, submitted_by_roster_id: 12 } });
  assert.deepEqual(own.recipients.map((r) => r.email), ['pit@x.test']);
});

test('the loader applies the document\'s view rows', async () => {
  const tables = baseTables({ enabled: true, extra_roster_ids: [] });
  tables.document_assignments = [{ company_id: 7, document_key: 'incident', audience_type: 'department', audience_value: 'safety', action: 'view', restricts: true, created_at: '2026-10-01T00:00:00Z', ended_at: null }];
  const out = await routeNotification(fakeDb(tables), { companyId: 7, documentKey: 'incident', record: { site_id: 50, submitted_by_roster_id: 12 } });
  assert.deepEqual(out.recipients.map((r) => r.email), ['owner@x.test'], 'the site supervisor is left out of this document, so the Owner is told');
});

test('a custom form uses its own title, cleaned', async () => {
  const sent = [];
  const db = fakeDb(baseTables({ enabled: true, extra_roster_ids: [] }));
  await notifyOnSubmit(db, { sendEmail: async (m) => { sent.push(m); }, companyId: 7, documentKey: 'incident', record: rec });
  assert.match(sent[0].subject, /^New Incident Report/);
});

// ── cooldown ────────────────────────────────────────────────────────────
const asSender = (sent) => async (m) => { sent.push(m); };

test('burst: a person gets up to the burst limit per document per window, then notices are held', async () => {
  const sent = [];
  const tables = baseTables({ enabled: true, extra_roster_ids: [] });
  const db = fakeDb(tables);
  const results = [];
  for (let i = 0; i < BURST_LIMIT + 2; i += 1) results.push(await notifyOnSubmit(db, { sendEmail: asSender(sent), companyId: 7, documentKey: 'incident', record: rec, siteName: 'Pit' }));
  assert.deepEqual(results.map((r) => r.sent), [2, 2, 2, 0, 0], 'two people, three emails each, then held');
  assert.deepEqual(results.map((r) => r.held), [0, 0, 0, 2, 2]);
  assert.equal(sent.length, 2 * BURST_LIMIT);
  assert.ok(tables.document_notification_state.every((r) => r.suppressed_count === 2), 'two held notices counted per person');
});

test('a junk submit cannot use up the slot a real incident needs', async () => {
  const sent = [];
  const db = fakeDb(baseTables({ enabled: true, extra_roster_ids: [] }));
  await notifyOnSubmit(db, { sendEmail: asSender(sent), companyId: 7, documentKey: 'incident', record: rec });
  const real = await notifyOnSubmit(db, { sendEmail: asSender(sent), companyId: 7, documentKey: 'incident', record: rec, siteName: 'Real incident site' });
  assert.equal(real.sent, 2, 'the second notice still goes out');
});

test('a new window reports how many notices were held, then resets', async () => {
  const sent = [];
  const tables = baseTables({ enabled: true, extra_roster_ids: [] });
  const clock = { now: Date.parse('2026-10-07T12:00:00Z') };
  const db = fakeDb(tables, { clock });
  const go = () => notifyOnSubmit(db, { sendEmail: asSender(sent), companyId: 7, documentKey: 'incident', record: rec });
  for (let i = 0; i < BURST_LIMIT + 2; i += 1) await go();
  clock.now += COOLDOWN_SECONDS * 1000 + 1000;
  const after = await go();
  assert.equal(after.sent, 2);
  assert.match(sent[sent.length - 1].text, /2 more Incident Reports were submitted since your last notice/);
  assert.ok(tables.document_notification_state.every((r) => r.suppressed_count === 0 && r.sent_in_window === 1), 'count resets once reported');
});

test('a burst of parallel submits still sends no more than the burst limit', async () => {
  const sent = [];
  const db = fakeDb(baseTables({ enabled: true, extra_roster_ids: [] }));
  await Promise.all(Array.from({ length: 20 }, () => notifyOnSubmit(db, { sendEmail: asSender(sent), companyId: 7, documentKey: 'incident', record: rec })));
  assert.equal(sent.length, 2 * BURST_LIMIT);
});

test('the window is per document and per person', async () => {
  const sent = [];
  const tables = baseTables({ enabled: true, extra_roster_ids: [] });
  tables.document_notifications.push({ company_id: 7, document_key: 'nearmiss', enabled: true, extra_roster_ids: [] });
  const db = fakeDb(tables);
  for (let i = 0; i < BURST_LIMIT; i += 1) await notifyOnSubmit(db, { sendEmail: asSender(sent), companyId: 7, documentKey: 'incident', record: rec });
  const other = await notifyOnSubmit(db, { sendEmail: asSender(sent), companyId: 7, documentKey: 'nearmiss', record: rec });
  assert.equal(other.sent, 2, 'a different document has its own window');
});

test('if the claim cannot be made, nothing is sent', async () => {
  const sent = [];
  const out = await notifyOnSubmit(fakeDb(baseTables({ enabled: true, extra_roster_ids: [] }), { failRpc: true }), { sendEmail: asSender(sent), companyId: 7, documentKey: 'incident', record: rec });
  assert.equal(out.sent, 0);
  assert.equal(sent.length, 0, 'no claim, no email: the cooldown is never skipped');
  assert.equal(out.reason, 'error');
});

test('a failed send is not retried on the same submit and does not break the others', async () => {
  const sent = [];
  let n = 0;
  const flaky = async (m) => { n += 1; if (n === 1) throw new Error('boom'); sent.push(m); };
  const out = await notifyOnSubmit(fakeDb(baseTables({ enabled: true, extra_roster_ids: [] })), { sendEmail: flaky, companyId: 7, documentKey: 'incident', record: rec });
  assert.equal(out.failed, 1);
  assert.equal(out.sent, 1);
  assert.equal(out.reason, 'partial', 'some told, one failed');
});
