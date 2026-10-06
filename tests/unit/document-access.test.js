// Document assignments and supervisor scope (server-lib/documentAccess.js).
//
// What is pinned here:
//   - no active rows = unchanged behaviour; rows only NARROW
//   - every audience type matches who it should and nobody else
//   - a division reaches its sites, so a division-tagged person sees the
//     records at those sites
//   - the Account Owner and the founder bypass everything; Owner status is
//     read from the roster row, not the token
//   - rule A: a supervisor sees only their own, their sites', and their
//     departments'/divisions' people's records; untagged = own records only
//   - the offline queue: a form filled in BEFORE a row existed (or while it
//     was still active) is still accepted when it drains later, and the
//     queued time cannot reach back more than the grace window
//   - a missing table/column (SQL not applied yet) behaves as "no rows",
//     any other read error fails closed with a retryable 503

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  matchesAudience, activeRowsAsOf, evaluateAccess, clampAsOf, recordInScope,
  requireAssignment, scopeRecords, requireRecordsAccess, menuAccessFor, isAssignableKey,
  GRACE_MS, SUBMIT, VIEW,
} = await import('../../server-lib/documentAccess.js');

// A fake supabase: each table answers its terminal call (limit or in) with
// its configured { data, error }.
function fakeDb(tables) {
  return {
    from(name) {
      const cfg = tables[name] || { data: [], error: null };
      const result = Promise.resolve({ data: cfg.data, error: cfg.error || null });
      const b = {
        select() { return b; },
        eq() { return b; },
        in() { return result; },
        limit() { return result; },
      };
      return b;
    },
  };
}

const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const actor = (over = {}) => ({
  bypass: false, rosterId: 5, role: 'worker', departments: [], divisionIds: [], siteIds: new Set(), ...over,
});
const row = (over = {}) => ({
  document_key: 'flha', audience_type: 'everyone', audience_value: null, action: 'submit',
  due_at: null, created_at: iso(NOW - 30 * DAY), ended_at: null, ...over,
});

// ── audiences ────────────────────────────────────────────────────────────

test('each audience type matches its own people and nobody else', () => {
  const a = actor({ rosterId: 5, role: 'worker', departments: ['safety'], divisionIds: [3], siteIds: new Set([9]) });
  assert.equal(matchesAudience(row(), a), true);
  assert.equal(matchesAudience(row({ audience_type: 'role', audience_value: 'worker' }), a), true);
  assert.equal(matchesAudience(row({ audience_type: 'role', audience_value: 'supervisor' }), a), false);
  assert.equal(matchesAudience(row({ audience_type: 'department', audience_value: 'safety' }), a), true);
  assert.equal(matchesAudience(row({ audience_type: 'department', audience_value: 'hr' }), a), false);
  assert.equal(matchesAudience(row({ audience_type: 'division', audience_value: '3' }), a), true);
  assert.equal(matchesAudience(row({ audience_type: 'division', audience_value: '4' }), a), false);
  assert.equal(matchesAudience(row({ audience_type: 'site', audience_value: '9' }), a), true);
  assert.equal(matchesAudience(row({ audience_type: 'site', audience_value: '10' }), a), false);
  assert.equal(matchesAudience(row({ audience_type: 'individual', audience_value: '5' }), a), true);
  assert.equal(matchesAudience(row({ audience_type: 'individual', audience_value: '6' }), a), false);
  assert.equal(matchesAudience(row({ audience_type: 'nonsense', audience_value: 'x' }), a), false);
});

// ── narrowing ────────────────────────────────────────────────────────────

test('no rows means unchanged behaviour', () => {
  assert.deepEqual(evaluateAccess([], actor(), SUBMIT, NOW), { narrowed: false, allowed: true });
});

test('a submit row narrows submit to its audience, and only submit', () => {
  const rows = [row({ audience_type: 'role', audience_value: 'supervisor' })];
  assert.equal(evaluateAccess(rows, actor({ role: 'worker' }), SUBMIT, NOW).allowed, false);
  assert.equal(evaluateAccess(rows, actor({ role: 'supervisor' }), SUBMIT, NOW).allowed, true);
  // a submit row says nothing about view
  assert.equal(evaluateAccess(rows, actor({ role: 'worker' }), VIEW, NOW).narrowed, false);
});

test('several rows are a union', () => {
  const rows = [
    row({ audience_type: 'site', audience_value: '9' }),
    row({ audience_type: 'individual', audience_value: '5' }),
  ];
  assert.equal(evaluateAccess(rows, actor({ rosterId: 5 }), SUBMIT, NOW).allowed, true);
  assert.equal(evaluateAccess(rows, actor({ rosterId: 6, siteIds: new Set([9]) }), SUBMIT, NOW).allowed, true);
  assert.equal(evaluateAccess(rows, actor({ rosterId: 6 }), SUBMIT, NOW).allowed, false);
});

test('the Owner bypasses every row', () => {
  const rows = [row({ audience_type: 'individual', audience_value: '99' })];
  assert.equal(evaluateAccess(rows, actor({ bypass: true }), SUBMIT, NOW).allowed, true);
});

// ── the offline queue ────────────────────────────────────────────────────

test('a row created after the form was filled in does not apply to it', () => {
  const rows = [row({ audience_type: 'individual', audience_value: '99', created_at: iso(NOW - 2 * HOUR) })];
  const filledAt = NOW - 5 * HOUR;
  assert.equal(evaluateAccess(rows, actor(), SUBMIT, filledAt).allowed, true, 'filled before the row existed');
  assert.equal(evaluateAccess(rows, actor(), SUBMIT, NOW).allowed, false, 'filled now');
});

test('a row ended after the form was filled in still applies to it', () => {
  const rows = [row({ audience_type: 'individual', audience_value: '5', ended_at: iso(NOW - 2 * HOUR) })];
  // The row is gone now, so a live submit is unrestricted...
  assert.equal(activeRowsAsOf(rows, NOW).length, 0);
  // ...and a form filled in while it was active is judged by it.
  assert.equal(activeRowsAsOf(rows, NOW - 5 * HOUR).length, 1);
});

test('clampAsOf: live, future, garbage and ancient times', () => {
  assert.equal(clampAsOf(undefined, NOW), NOW);
  assert.equal(clampAsOf('', NOW), NOW);
  assert.equal(clampAsOf('not a date', NOW), NOW);
  assert.equal(clampAsOf(iso(NOW + DAY), NOW), NOW, 'a future queued time cannot buy anything');
  assert.equal(clampAsOf(iso(NOW - 2 * HOUR), NOW), NOW - 2 * HOUR);
  assert.equal(clampAsOf(iso(NOW - 40 * DAY), NOW), NOW - GRACE_MS, 'reach-back is capped');
});

// ── requireAssignment end to end on a fake db ────────────────────────────

const session = (over = {}) => ({ role: 'worker', userId: 5, companyId: 1, ...over });
const rosterRow = (over = {}) => ({ id: 5, role: 'worker', is_owner: false, departments: [], divisions: [], default_site_id: null, company_id: 1, ...over });

test('requireAssignment: allowed with no rows, 403 when narrowed away, null for the founder', async () => {
  const open = fakeDb({ roster: { data: [rosterRow()] }, document_assignments: { data: [] } });
  assert.equal(await requireAssignment(open, session(), 'flha', SUBMIT), null);

  const narrowed = fakeDb({
    roster: { data: [rosterRow()] },
    document_assignments: { data: [row({ audience_type: 'individual', audience_value: '99' })] },
  });
  const denied = await requireAssignment(narrowed, session(), 'flha', SUBMIT);
  assert.equal(denied.status, 403);

  assert.equal(await requireAssignment(narrowed, { role: 'admin', companyId: null }, 'flha', SUBMIT), null);
});

test('requireAssignment: Owner status comes from the roster row, not the token', async () => {
  const rows = { document_assignments: { data: [row({ audience_type: 'individual', audience_value: '99' })] } };
  const demoted = fakeDb({ ...rows, roster: { data: [rosterRow({ role: 'supervisor', is_owner: false })] } });
  // The token still claims Owner; the roster row says otherwise.
  const d = await requireAssignment(demoted, session({ role: 'supervisor', isOwner: true }), 'flha', SUBMIT);
  assert.equal(d.status, 403);
  const owner = fakeDb({ ...rows, roster: { data: [rosterRow({ role: 'supervisor', is_owner: true })] } });
  assert.equal(await requireAssignment(owner, session({ role: 'supervisor' }), 'flha', SUBMIT), null);
});

test('requireAssignment: a division reaches its sites', async () => {
  const db = fakeDb({
    roster: { data: [rosterRow({ divisions: [3] })] },
    sites: { data: [{ id: 9 }] },
    document_assignments: { data: [row({ audience_type: 'site', audience_value: '9' })] },
  });
  assert.equal(await requireAssignment(db, session(), 'flha', SUBMIT), null);
});

test('requireAssignment: a worker is never narrowed by view rows', async () => {
  const db = fakeDb({
    roster: { data: [rosterRow()] },
    document_assignments: { data: [row({ action: 'view', audience_type: 'role', audience_value: 'supervisor' })] },
  });
  assert.equal(await requireAssignment(db, session(), 'flha', VIEW), null);
});

test('requireAssignment: an old queued submit passes a row created after it was filled in', async () => {
  const db = fakeDb({
    roster: { data: [rosterRow()] },
    document_assignments: { data: [row({ audience_type: 'individual', audience_value: '99', created_at: iso(Date.now() - 2 * HOUR) })] },
  });
  assert.equal(await requireAssignment(db, session(), 'flha', SUBMIT, { asOf: iso(Date.now() - 5 * HOUR) }), null);
  assert.equal((await requireAssignment(db, session(), 'flha', SUBMIT)).status, 403);
});

test('missing table or column behaves as no rows; any other error fails closed with 503', async () => {
  const missingTable = fakeDb({ roster: { data: [rosterRow()] }, document_assignments: { data: null, error: { code: '42P01' } } });
  assert.equal(await requireAssignment(missingTable, session(), 'flha', SUBMIT), null);
  const missingCache = fakeDb({ roster: { data: [rosterRow()] }, document_assignments: { data: null, error: { code: 'PGRST205' } } });
  assert.equal(await requireAssignment(missingCache, session(), 'flha', SUBMIT), null);
  const broken = fakeDb({ roster: { data: [rosterRow()] }, document_assignments: { data: null, error: { code: '57014' } } });
  assert.equal((await requireAssignment(broken, session(), 'flha', SUBMIT)).status, 503);
  const rosterBroken = fakeDb({ roster: { data: null, error: { code: '57014' } } });
  assert.equal((await requireAssignment(rosterBroken, session(), 'flha', SUBMIT)).status, 503);
});

test('a person from another company is not an actor', async () => {
  const db = fakeDb({ roster: { data: [rosterRow({ company_id: 2 })] } });
  assert.equal((await requireAssignment(db, session(), 'flha', SUBMIT)).status, 401);
});

// ── rule A: supervisor scope ─────────────────────────────────────────────

test('recordInScope: own, site, department and division, and nothing else', () => {
  const sup = actor({ role: 'supervisor', rosterId: 21, departments: ['safety'], divisionIds: [3], siteIds: new Set([9]) });
  const tags = new Map([[7, { departments: ['safety'], divisions: [] }], [8, { departments: ['hr'], divisions: [3] }], [9, { departments: ['hr'], divisions: [4] }]]);
  assert.equal(recordInScope({ submitted_by_roster_id: 21 }, sup, tags), true, 'own');
  assert.equal(recordInScope({ site_id: 9, submitted_by_roster_id: 99 }, sup, tags), true, 'site');
  assert.equal(recordInScope({ site_id: 1, submitted_by_roster_id: 7 }, sup, tags), true, 'author department');
  assert.equal(recordInScope({ site_id: 1, submitted_by_roster_id: 8 }, sup, tags), true, 'author division');
  assert.equal(recordInScope({ site_id: 1, submitted_by_roster_id: 9 }, sup, tags), false, 'nothing in common');
  assert.equal(recordInScope({ site_id: null, submitted_by_roster_id: null }, sup, tags), false, 'anonymous, no site');
});

test('recordInScope: an untagged supervisor sees only their own records', () => {
  const sup = actor({ role: 'supervisor', rosterId: 21 });
  const tags = new Map([[7, { departments: ['safety'], divisions: [3] }]]);
  assert.equal(recordInScope({ submitted_by_roster_id: 21 }, sup, tags), true);
  assert.equal(recordInScope({ site_id: 9, submitted_by_roster_id: 7 }, sup, tags), false);
});

test('an anonymous near miss is placed by site only, never by author tags', () => {
  const sup = actor({ role: 'supervisor', rosterId: 21, siteIds: new Set([9]) });
  assert.equal(recordInScope({ site_id: 9, submitted_by_roster_id: null, is_anonymous: true }, sup, new Map()), true);
  assert.equal(recordInScope({ site_id: 4, submitted_by_roster_id: null, is_anonymous: true }, sup, new Map()), false);
});

test('scopeRecords: Owner and founder see everything, a supervisor is filtered', async () => {
  const records = [{ id: 1, site_id: 9, submitted_by_roster_id: 7 }, { id: 2, site_id: 1, submitted_by_roster_id: 8 }];
  const owner = fakeDb({ roster: { data: [rosterRow({ id: 21, role: 'supervisor', is_owner: true })] } });
  assert.equal((await scopeRecords(owner, session({ role: 'supervisor', userId: 21 }), records)).records.length, 2);
  assert.equal((await scopeRecords(owner, { role: 'admin', companyId: null }, records)).records.length, 2);

  // The roster table answers both the actor lookup (limit) and the author
  // tag lookup (in) with the same rows here, which is enough for this check.
  const sup = fakeDb({ roster: { data: [rosterRow({ id: 21, role: 'supervisor', default_site_id: 9, departments: [] })] }, sites: { data: [] } });
  const out = await scopeRecords(sup, session({ role: 'supervisor', userId: 21 }), records);
  assert.deepEqual(out.records.map((r) => r.id), [1]);
});

test('requireRecordsAccess: 403 when any record is outside the supervisor scope', async () => {
  const sup = fakeDb({
    roster: { data: [rosterRow({ id: 21, role: 'supervisor', default_site_id: 9 })] },
    document_assignments: { data: [] },
  });
  const s = session({ role: 'supervisor', userId: 21 });
  assert.equal(await requireRecordsAccess(sup, s, 'flha', [{ site_id: 9 }]), null);
  assert.equal((await requireRecordsAccess(sup, s, 'flha', [{ site_id: 9 }, { site_id: 1 }])).status, 403);
});

// ── menu ─────────────────────────────────────────────────────────────────

test('menuAccessFor hides narrowed documents and reports assignments with the earliest due date', async () => {
  const db = fakeDb({
    roster: { data: [rosterRow()] },
    document_assignments: {
      data: [
        row({ document_key: 'flha', audience_type: 'individual', audience_value: '5', due_at: iso(NOW + 3 * DAY) }),
        row({ document_key: 'flha', audience_type: 'role', audience_value: 'worker', due_at: iso(NOW + 1 * DAY) }),
        row({ document_key: 'incident', audience_type: 'individual', audience_value: '99' }),
      ],
    },
  });
  const out = await menuAccessFor(db, session(), ['flha', 'incident', 'daily', 'timeclock']);
  assert.equal(out.allowedKeys.has('flha'), true);
  assert.equal(out.allowedKeys.has('incident'), false, 'assigned to someone else');
  assert.equal(out.allowedKeys.has('daily'), true, 'no rows');
  assert.equal(out.allowedKeys.has('timeclock'), true, 'not an assignable document, never hidden');
  assert.deepEqual(out.assigned.map((a) => a.documentKey), ['flha']);
  assert.equal(out.assigned[0].dueAt, iso(NOW + 1 * DAY));
});

test('menuAccessFor: a read failure returns null so the caller shows everything', async () => {
  const db = fakeDb({ roster: { data: [rosterRow()] }, document_assignments: { data: null, error: { code: '57014' } } });
  const out = await menuAccessFor(db, session(), ['flha']);
  assert.equal(out.allowedKeys, null);
});

test('only enforced documents are assignable', () => {
  for (const k of ['flha', 'inspection', 'toolbox', 'nearmiss', 'incident', 'daily', 'monthly', 'fuellog', 'custom_12', 'portal_3']) {
    assert.equal(isAssignableKey(k), true, k);
  }
  for (const k of ['timeclock', 'certifications', 'maintenance', 'equipment_reports', 'equipment_compliance', 'custom_', 'custom_x', 'portal_', '']) {
    assert.equal(isAssignableKey(k), false, k);
  }
});
