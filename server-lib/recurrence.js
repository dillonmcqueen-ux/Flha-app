// server-lib/recurrence.js
// "This keeps happening" detection for equipment defects.
//
// Dillon, 2026-09-17, describing the gap this closes:
//
//   "there was no log for it anywhere that that unit had a flat tire
//    previously to see if it becomes a pattern. 3 low tire corrective
//    actions in a row should flag something as a pattern to say 'hey maybe
//    this tire needs to be repaired or replaced'"
//
// A corrective action answers "who is fixing this, by when". It does not
// answer "is this the fourth time this month". Those are different
// questions and the second one is the one that says replace the tire
// instead of airing it up again.
//
// ── Why this lives in server-lib and not in one handler ─────────────────
//
// Two consumers need the same answer: the corrective-actions list (so a
// supervisor reading one action knows it is a repeat) and the maintenance
// screen (so a machine carries its own repeat-offender list). Break #1 in
// docs/feature-interaction-map.md happened because two handlers computed
// the same thing from the same tables with two copies of the logic and
// drifted. One reducer, two callers.

// Dillon's call, 2026-09-17: 3 occurrences of the same item on the same
// machine inside a rolling 90 days. The window is the part that matters —
// without it a machine four years old sits permanently flagged for a fault
// that was properly fixed two years ago, and the flag stops meaning
// anything the moment a supervisor learns to ignore it.
export const RECURRENCE_THRESHOLD = 3;
export const RECURRENCE_WINDOW_DAYS = 90;

// The normalizer is shared with the migration's backfill
// (docs/schema/corrective-actions-equipment-recurrence-migration.sql), which
// does `lower(btrim(regexp_replace(item, '\s+', ' ', 'g')))`. The two must
// agree or a backfilled row and a freshly written one describe the same
// checklist line with two different keys and never count together.
export function normalizeItemKey(raw) {
  if (typeof raw !== 'string') return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  return collapsed ? collapsed.slice(0, 200) : null;
}

// Same shape as the label normalizer the weekly equipment report uses for
// free-text machines (break #7). A machine picked from the fleet keys on its
// real id; one typed by hand keys on its normalized label, and the two key
// spaces are namespaced so a free-text row can never be counted against a
// registered machine it merely resembles.
export function machineKey(action) {
  if (!action) return null;
  if (action.equipment_id != null && action.equipment_id !== '') return `id:${action.equipment_id}`;
  const label = typeof action.equipment_label === 'string' ? action.equipment_label.replace(/\s+/g, ' ').trim().toLowerCase() : '';
  if (!label) return null;
  // The company has to be part of a LABEL key, and only a label key.
  //
  // equipment.id is a global primary key, so an id already identifies one
  // company's machine. A label does not: "Kenworth T800" is a string two
  // tenants can both type. api/monthly.js runs this over whatever
  // list_corrective_actions returned, which for an ADMIN session is every
  // company at once — so without this, two companies each reporting a flat
  // tire twice on their own "Kenworth T800" would merge into one group of
  // four and report a pattern that exists in neither of them, built out of
  // another tenant's data.
  return `co:${action.company_id ?? 'none'}|label:${label}`;
}

// A recurrence is a machine plus a checklist item. Both are required: an
// action with no item key (every monthly answer, every incident, and every
// pre-migration equipment row) cannot be compared to anything and is left
// out rather than bucketed into a catch-all that would report nonsense
// counts.
export function recurrenceKey(action) {
  const machine = machineKey(action);
  const item = normalizeItemKey(action && action.item_key);
  if (!machine || !item) return null;
  return `${machine}|${item}`;
}

function occurredAt(action) {
  const raw = action && (action.created_at || action.occurred_at);
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Buckets corrective actions into recurrence groups and counts each one
 * inside the rolling window.
 *
 * Resolved actions count. That is the whole point: three flat tires in a
 * quarter is a pattern precisely *because* somebody fixed the first two.
 * Counting only open ones would mean a machine that gets patched up every
 * week never trips the threshold, which is exactly backwards.
 *
 * Returns a Map keyed by recurrenceKey() so both callers can look a single
 * action up in O(1) rather than re-scanning.
 */
export function summarizeRecurrence(actions, { now = Date.now(), windowDays = RECURRENCE_WINDOW_DAYS, threshold = RECURRENCE_THRESHOLD } = {}) {
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const groups = new Map();

  for (const action of Array.isArray(actions) ? actions : []) {
    const key = recurrenceKey(action);
    if (!key) continue;
    const at = occurredAt(action);
    // An action with no readable timestamp cannot be placed in or out of
    // the window. Counting it would inflate a pattern that may be years
    // old; it is skipped rather than guessed at.
    if (at == null || at < cutoff) continue;

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        equipmentId: action.equipment_id ?? null,
        equipmentLabel: action.equipment_label || null,
        itemKey: normalizeItemKey(action.item_key),
        count: 0,
        openCount: 0,
        firstSeen: null,
        lastSeen: null,
        windowDays,
        threshold,
        isPattern: false,
      };
      groups.set(key, group);
    }
    group.count += 1;
    if (action.status !== 'resolved') group.openCount += 1;
    if (group.firstSeen == null || at < group.firstSeen) group.firstSeen = at;
    if (group.lastSeen == null || at > group.lastSeen) group.lastSeen = at;
    // The most recent description reads best on the machine's card — it is
    // the wording of the latest report rather than the oldest.
    if (at === group.lastSeen && typeof action.description === 'string') group.sampleDescription = action.description;
  }

  for (const group of groups.values()) {
    group.isPattern = group.count >= threshold;
    group.firstSeen = group.firstSeen != null ? new Date(group.firstSeen).toISOString() : null;
    group.lastSeen = group.lastSeen != null ? new Date(group.lastSeen).toISOString() : null;
  }
  return groups;
}

/**
 * Attaches a `recurrence` object to every action that belongs to a group.
 *
 * Deliberately attaches to every grouped action, not only the ones past the
 * threshold: "2nd time in 90 days" is useful context on a single action
 * even before it becomes a pattern, and the UI decides how loudly to say
 * it from `isPattern`.
 */
export function annotateRecurrence(actions, options = {}) {
  const groups = summarizeRecurrence(actions, options);
  return (Array.isArray(actions) ? actions : []).map((action) => {
    const key = recurrenceKey(action);
    const group = key ? groups.get(key) : null;
    if (!group) return { ...action, recurrence: null };
    return {
      ...action,
      recurrence: {
        count: group.count,
        openCount: group.openCount,
        windowDays: group.windowDays,
        threshold: group.threshold,
        isPattern: group.isPattern,
        firstSeen: group.firstSeen,
        lastSeen: group.lastSeen,
      },
    };
  });
}

/**
 * The per-machine view: every recurrence group that has crossed the
 * threshold, keyed by equipment id, newest-first within each machine.
 *
 * Only fleet-registered machines appear. A free-text machine has no id to
 * hang the group on in the maintenance screen, which lists the registered
 * fleet — its recurrences are still visible on the corrective action
 * itself, which is the only place they can be shown honestly.
 */
export function patternsByEquipment(actions, options = {}) {
  const byEquipment = {};
  for (const group of summarizeRecurrence(actions, options).values()) {
    if (!group.isPattern) continue;
    if (group.equipmentId == null) continue;
    if (!byEquipment[group.equipmentId]) byEquipment[group.equipmentId] = [];
    byEquipment[group.equipmentId].push(group);
  }
  for (const list of Object.values(byEquipment)) {
    list.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
  }
  return byEquipment;
}
