// Pins which findings can open a trackable corrective action.
//
// corrective_actions.answer_id was bigint NOT NULL with a foreign key to
// inspection_answers, so a corrective action structurally could not exist
// without a monthly site inspection behind it. An incident, a near miss and
// a failed equipment inspection each produce a finding somebody has to act
// on, and none of them could have one.
//
// What made it easy to miss for so long: incidents and near misses already
// carry a `correctiveActions` array in report_json — AI-drafted, edited by
// the reporter, printed on the PDF. On paper the loop looks closed. But it
// was inert text: no owner, no target date, no status, no aging, and it
// never reached the dashboard's Open Corrective Actions count.
//
// What these cases exist to stop coming back:
//   * a "Monitor" item quietly becoming a tracked action and burying the
//     real defects;
//   * one finding opening an unbounded number of rows;
//   * a resubmitted offline report doubling up the same actions;
//   * the answer_id/source_type contract drifting from the CHECK constraint.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  CORRECTIVE_SOURCE_TYPES,
  correctiveActionsFromReport,
  correctiveActionsFromInspection,
  openCorrectiveActions,
} = await import('../../server-lib/correctiveActions.js');

const item = (name, condition, note) => ({ item: name, category: 'Fluids', condition, ...(note ? { note } : {}) });

// ── Extracting descriptions ───────────────────────────────────────────

test('an incident report yields its own corrective actions', () => {
  const out = correctiveActionsFromReport({
    correctiveActions: ['Re-train crew on lockout', 'Replace the damaged guard'],
  });
  assert.deepEqual(out, ['Re-train crew on lockout', 'Replace the damaged guard']);
});

test('a report with no corrective actions yields none', () => {
  assert.deepEqual(correctiveActionsFromReport({}), []);
  assert.deepEqual(correctiveActionsFromReport(null), []);
  assert.deepEqual(correctiveActionsFromReport({ correctiveActions: 'not an array' }), []);
  assert.deepEqual(correctiveActionsFromReport({ correctiveActions: ['', '   ', null, 7] }), []);
});

test('only Defective inspection items open actions, never Monitor', () => {
  // Monitor is an operator saying "watch this". Tracking every one would
  // bury the genuine defects in the same list.
  const out = correctiveActionsFromInspection({
    items: [
      item('Engine oil level', 'Good'),
      item('Hydraulic fluid level', 'Defective'),
      item('Belts and hoses', 'Monitor'),
      item('Air filter', 'N/A'),
    ],
  }, 'CAT 336 (Unit 12)');
  // Now {description, itemKey} rather than a bare string: the description is
  // what a supervisor reads, the item key is what recurrence counting and
  // post-trip resolution match on. They cannot be the same value — the
  // description carries the machine label and the operator's note, both of
  // which differ on every report of the same fault.
  assert.deepEqual(out, [{ description: 'CAT 336 (Unit 12): Hydraulic fluid level', itemKey: 'hydraulic fluid level' }]);
});

test('an inspection defect carries the operator note when there is one', () => {
  const out = correctiveActionsFromInspection({
    items: [item('Rear tire', 'Defective', 'sidewall cut, losing air')],
  }, 'Kenworth T800');
  assert.deepEqual(out, [{ description: 'Kenworth T800: Rear tire — sidewall cut, losing air', itemKey: 'rear tire' }]);
});

test('an unlabeled machine still produces a usable description', () => {
  const out = correctiveActionsFromInspection({ items: [item('Rear tire', 'Defective')] }, '   ');
  assert.deepEqual(out, [{ description: 'Rear tire', itemKey: 'rear tire' }]);
});

test('a clean inspection opens nothing', () => {
  assert.deepEqual(correctiveActionsFromInspection({ items: [item('Engine oil level', 'Good')] }, 'X'), []);
  assert.deepEqual(correctiveActionsFromInspection(null, 'X'), []);
  assert.deepEqual(correctiveActionsFromInspection({ items: 'nope' }, 'X'), []);
});

// ── Writing them ──────────────────────────────────────────────────────

function fakeDb({ existing = [], insertError = null, selectError = null } = {}) {
  const calls = { inserted: null };
  return {
    calls,
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        // The chain is awaited at the end of the .eq() calls in the helper.
        then(resolve) { resolve({ data: existing, error: selectError }); },
        insert(rows) {
          calls.inserted = rows;
          return Promise.resolve({ error: insertError });
        },
      };
    },
  };
}

test('an incident opens one row per corrective action', async () => {
  const db = fakeDb();
  const n = await openCorrectiveActions(db, {
    companyId: 1, sourceType: 'incident', sourceId: 42,
    descriptions: ['Re-train crew', 'Replace guard'],
  });
  assert.equal(n, 2);
  assert.equal(db.calls.inserted.length, 2);
  assert.equal(db.calls.inserted[0].company_id, 1);
  assert.equal(db.calls.inserted[0].source_type, 'incident');
  assert.equal(db.calls.inserted[0].source_id, 42);
  assert.equal(db.calls.inserted[0].answer_id, null);
  assert.equal(db.calls.inserted[0].status, 'open');
});

test('descriptions already open for the same source are skipped', async () => {
  // A queued offline report draining twice must not double the list.
  const db = fakeDb({ existing: [{ description: 'Re-train crew' }] });
  const n = await openCorrectiveActions(db, {
    companyId: 1, sourceType: 'incident', sourceId: 42,
    descriptions: ['Re-train crew', 'Replace guard'],
  });
  assert.equal(n, 1);
  assert.deepEqual(db.calls.inserted.map(r => r.description), ['Replace guard']);
});

test('a source whose actions all already exist writes nothing', async () => {
  const db = fakeDb({ existing: [{ description: 'Re-train crew' }] });
  const n = await openCorrectiveActions(db, {
    companyId: 1, sourceType: 'incident', sourceId: 42, descriptions: ['Re-train crew'],
  });
  assert.equal(n, 0);
  assert.equal(db.calls.inserted, null);
});

test('a monthly action must carry its answer_id, and no other source may', async () => {
  // This mirrors the corrective_actions_answer_id_matches_source CHECK. The
  // database enforces it; failing here keeps the error readable.
  const db1 = fakeDb();
  assert.equal(await openCorrectiveActions(db1, {
    companyId: 1, sourceType: 'monthly_answer', sourceId: 7, descriptions: ['x'],
  }), 0, 'monthly without answerId must be refused');

  const db2 = fakeDb();
  assert.equal(await openCorrectiveActions(db2, {
    companyId: 1, sourceType: 'incident', sourceId: 7, answerId: 7, descriptions: ['x'],
  }), 0, 'non-monthly with answerId must be refused');

  const db3 = fakeDb();
  assert.equal(await openCorrectiveActions(db3, {
    companyId: 1, sourceType: 'monthly_answer', sourceId: 7, answerId: 7, descriptions: ['x'],
  }), 1);
  assert.equal(db3.calls.inserted[0].answer_id, 7);
});

test('an unknown source type is refused rather than sent to the database', async () => {
  const db = fakeDb();
  assert.equal(await openCorrectiveActions(db, {
    companyId: 1, sourceType: 'made_up', sourceId: 7, descriptions: ['x'],
  }), 0);
  assert.equal(db.calls.inserted, null);
});

test('the source types match the CHECK constraint exactly', () => {
  assert.deepEqual(
    [...CORRECTIVE_SOURCE_TYPES].sort(),
    ['equipment_inspection', 'incident', 'monthly_answer', 'near_miss'],
  );
});

test('one finding cannot open an unbounded number of rows', async () => {
  // A machine with thirty defective items needs taking out of service, not
  // thirty dashboard entries.
  const db = fakeDb();
  const n = await openCorrectiveActions(db, {
    companyId: 1, sourceType: 'equipment_inspection', sourceId: 7,
    descriptions: Array.from({ length: 40 }, (_, i) => `defect ${i}`),
  });
  assert.equal(n, 10);
});

test('descriptions are length-capped', async () => {
  const db = fakeDb();
  await openCorrectiveActions(db, {
    companyId: 1, sourceType: 'incident', sourceId: 7, descriptions: ['x'.repeat(900)],
  });
  assert.equal(db.calls.inserted[0].description.length, 500);
});

test('a failed insert is swallowed, never thrown at the submit', async () => {
  // The report is already saved by the time this runs. A worker on a
  // jobsite must not lose a finished incident because a follow-up row
  // could not be written.
  const db = fakeDb({ insertError: { message: 'boom' } });
  assert.equal(await openCorrectiveActions(db, {
    companyId: 1, sourceType: 'incident', sourceId: 7, descriptions: ['x'],
  }), 0);

  const db2 = fakeDb({ selectError: { message: 'boom' } });
  assert.equal(await openCorrectiveActions(db2, {
    companyId: 1, sourceType: 'incident', sourceId: 7, descriptions: ['x'],
  }), 0);

  assert.equal(await openCorrectiveActions(null, {
    companyId: 1, sourceType: 'incident', sourceId: 7, descriptions: ['x'],
  }), 0, 'a broken client must not throw');
});

test('a missing company or source writes nothing', async () => {
  const db = fakeDb();
  assert.equal(await openCorrectiveActions(db, { companyId: null, sourceType: 'incident', sourceId: 7, descriptions: ['x'] }), 0);
  assert.equal(await openCorrectiveActions(db, { companyId: 1, sourceType: 'incident', sourceId: null, descriptions: ['x'] }), 0);
  assert.equal(db.calls.inserted, null);
});
