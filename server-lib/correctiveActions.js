// server-lib/correctiveActions.js
// Opening trackable corrective actions from any finding, not just a failed
// monthly-inspection question.
//
// Break #5 in docs/feature-interaction-map.md. corrective_actions.answer_id
// was bigint NOT NULL with a foreign key to inspection_answers, so a
// corrective action could not exist without a monthly inspection behind it.
// An incident, a near miss and a failed equipment inspection all produce a
// finding someone has to action, and none of them could have one.
//
// What made it easy to miss: incidents and near misses already carry a
// `correctiveActions` array inside report_json — AI-drafted, printed on the
// PDF. It looks finished on paper. But it is inert text: no owner, no target
// date, no status, no aging, and it never reached the Open Corrective
// Actions count on the dashboard. Two incompatible shapes of one idea.
//
// The `corrective_actions_any_source` migration added company_id,
// source_type and source_id (the same shape company_signals already uses)
// and made answer_id nullable. This module is the one place that writes
// them, so the four callers cannot drift apart the way the signal writers
// did.
//
// ── 2026-09-17: machine identity, item identity, and closing the loop ────
//
// `corrective-actions-equipment-recurrence-migration.sql` added five more
// columns, for two things the table could not previously express:
//
//   equipment_id / equipment_label  — WHICH machine this is about. Without
//     it, "has this unit had a flat tire before?" has no answer: the only
//     pointer was source_id -> inspections.id, i.e. one single inspection.
//   item_key                        — WHICH checklist line. The pair is what
//     server-lib/recurrence.js counts to say "third time in 90 days".
//   resolved_note / resolved_by / resolution_source
//                                   — HOW it got closed, and by whom. A
//     post-trip that clears a defect now writes the repair down instead of
//     flipping a status with no record of what was actually done.
//
// All five are nullable. That is not laziness: a monthly answer has no
// machine and no checklist item, an incident has neither, and every row
// written before the migration has none of them. A nullable column that
// degrades to "we don't know" is the same choice site_id and
// submitted_by_roster_id made for the same reason.

import { normalizeItemKey, machineKey } from './recurrence.js';

// Mirrors the corrective_actions_source_type_check constraint. Adding a
// source means editing both; the constraint is what actually enforces it.
export const CORRECTIVE_SOURCE_TYPES = ['monthly_answer', 'incident', 'near_miss', 'equipment_inspection'];

const MAX_DESCRIPTION = 500;
// A single finding should never be able to open an unbounded number of
// rows. An inspection with thirty defective items is a machine that needs
// taking out of service, not thirty dashboard entries.
const MAX_ACTIONS_PER_SOURCE = 10;

function cleanDescription(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_DESCRIPTION);
}

function cleanLabel(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

// Callers may pass plain strings (incidents, near misses, monthly answers —
// findings with no checklist item behind them) or {description, itemKey}
// objects (equipment inspections). Both shapes normalize to the same thing
// so openCorrectiveActions has one code path rather than a branch per
// caller, which is how the four writers drifted apart last time.
function normalizeFindings(input) {
  return (Array.isArray(input) ? input : [input])
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        return { description: cleanDescription(entry.description), itemKey: normalizeItemKey(entry.itemKey) };
      }
      return { description: cleanDescription(entry), itemKey: null };
    })
    .filter((f) => f.description);
}

// PostgREST reports an unknown column either as PGRST204 (its schema cache
// rejected the payload) or as Postgres 42703 (undefined_column) once the
// statement reaches the database. Matching on the codes rather than the
// message text, with the message as a last resort, because the message
// wording is not a stable contract.
function isMissingColumnError(error) {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  const msg = String(error.message || '');
  return /column .* does not exist|could not find the .* column/i.test(msg);
}

/**
 * Opens corrective actions for one finding, skipping any that already exist.
 *
 * Best-effort by design, exactly like the company_signals writers: the
 * record this is about is already saved by the time this runs, so a failure
 * here is logged and swallowed rather than turned into a failed submit. A
 * worker on a jobsite must never lose a finished incident report because a
 * follow-up row could not be written.
 *
 * Returns the number of actions created (0 on any failure), so a caller can
 * report it without having to care whether it worked.
 */
export async function openCorrectiveActions(supabaseAdmin, {
  companyId,
  sourceType,
  sourceId,
  descriptions,
  answerId = null,
  equipmentId = null,
  equipmentLabel = null,
}) {
  try {
    if (!companyId || !sourceId) return 0;
    if (!CORRECTIVE_SOURCE_TYPES.includes(sourceType)) {
      console.error('openCorrectiveActions: unknown sourceType', sourceType);
      return 0;
    }
    // The CHECK constraint enforces this too; failing here keeps the error
    // readable instead of surfacing as a constraint violation.
    if ((sourceType === 'monthly_answer') !== (answerId != null)) {
      console.error('openCorrectiveActions: answerId must be set for monthly_answer and null otherwise', sourceType);
      return 0;
    }

    const wanted = normalizeFindings(descriptions).slice(0, MAX_ACTIONS_PER_SOURCE);
    if (wanted.length === 0) return 0;

    // Re-submitting a queued offline report must not open the same actions
    // twice. The submit handlers dedupe the record itself by
    // client_submission_id, but update_monthly can also re-run over answers
    // that already have one, so the guard lives here for every caller.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('corrective_actions')
      .select('description')
      .eq('company_id', companyId)
      .eq('source_type', sourceType)
      .eq('source_id', String(sourceId));
    if (existingErr) {
      console.error('openCorrectiveActions: could not read existing actions', existingErr.message);
      return 0;
    }

    const already = new Set((existing || []).map((r) => r.description));
    let fresh = wanted.filter((f) => !already.has(f.description));
    if (fresh.length === 0) return 0;

    // ── One open action per machine per fault, across inspections ────────
    //
    // The dedupe above only looks at THIS source_id, which is one single
    // inspection. That is right for an incident or a monthly answer, where
    // the source is the finding. It is wrong for a machine: a flat tire
    // flagged Monday and still flat on Tuesday is one unfixed defect, not
    // two, and letting Tuesday open a second row does two bad things at
    // once — it doubles the supervisor's open list, and it counts toward the
    // 3-in-90-days pattern threshold, so a fault nobody has got round to
    // fixing starts reporting itself as a recurring fault.
    //
    // A recurrence has to mean "this was closed and it came back". That is
    // what makes "maybe this tire needs replacing" a true statement rather
    // than a restatement of "nobody fixed the tire".
    //
    // Only equipment inspections are deduped this way, because only they
    // have a machine and an item to key on.
    if (sourceType === 'equipment_inspection' && (equipmentId != null || cleanLabel(equipmentLabel))) {
      const keys = fresh.map((f) => f.itemKey).filter(Boolean);
      if (keys.length > 0) {
        // Same machine-matching rule as resolveCorrectiveActionsForItems
        // below — read narrow, match with machineKey() — for the same
        // reason. Here the mismatched version would SUPPRESS a legitimately
        // new action on the registered unit because a free-text row happened
        // to share its label.
        const { data: openRows, error: openErr } = await supabaseAdmin
          .from('corrective_actions')
          .select('item_key, equipment_id, equipment_label, company_id')
          .eq('company_id', companyId)
          .eq('source_type', 'equipment_inspection')
          .neq('status', 'resolved')
          .in('item_key', [...new Set(keys)]);
        // A read failure here must not block the write. Missing columns
        // means the migration has not run, in which case there is nothing to
        // dedupe against anyway and the fallback path below writes the row
        // the old way.
        if (openErr) {
          if (!isMissingColumnError(openErr)) console.error('openCorrectiveActions: open-defect dedupe read failed', openErr.message);
        } else {
          const wantedMachine = machineKey({ company_id: companyId, equipment_id: equipmentId, equipment_label: equipmentLabel });
          const openKeys = new Set(
            (openRows || []).filter((r) => machineKey(r) === wantedMachine).map((r) => r.item_key)
          );
          fresh = fresh.filter((f) => !f.itemKey || !openKeys.has(f.itemKey));
          if (fresh.length === 0) return 0;
        }
      }
    }

    const base = fresh.map((f) => ({
      company_id: companyId,
      source_type: sourceType,
      source_id: sourceId,
      answer_id: answerId,
      description: f.description,
      status: 'open',
    }));
    const enriched = base.map((row, i) => ({
      ...row,
      equipment_id: equipmentId ?? null,
      equipment_label: cleanLabel(equipmentLabel),
      item_key: fresh[i].itemKey,
    }));

    const { error } = await supabaseAdmin.from('corrective_actions').insert(enriched);
    if (!error) return enriched.length;

    // The deploy-window fallback. docs/schema/corrective-actions-any-source-
    // migration.sql records what happened last time a column contract and a
    // deploy got out of order: monthly corrective actions silently stopped
    // being created and nothing logged it, because this helper swallows its
    // own errors by design.
    //
    // So if the five new columns are not in the database yet, write the row
    // WITHOUT them rather than writing nothing. A supervisor gets the
    // corrective action they would have got before this change; only the
    // recurrence counting is unavailable, and only until the migration runs.
    // Losing the action itself is not an acceptable failure mode.
    if (!isMissingColumnError(error)) {
      console.error('openCorrectiveActions: insert failed', sourceType, sourceId, error.message);
      return 0;
    }
    console.error('openCorrectiveActions: equipment/item columns missing — apply corrective-actions-equipment-recurrence-migration.sql; writing without them');
    const { error: retryErr } = await supabaseAdmin.from('corrective_actions').insert(base);
    if (retryErr) {
      console.error('openCorrectiveActions: fallback insert failed', sourceType, sourceId, retryErr.message);
      return 0;
    }
    return base.length;
  } catch (e) {
    console.error('openCorrectiveActions: unexpected failure', e.message);
    return 0;
  }
}

/**
 * Closes open equipment-inspection actions for specific checklist items on
 * one machine, and records what was actually done about them.
 *
 * Dillon, 2026-09-17: "if the person marks the post trip as the issue no
 * longer exists, it can be marked in corrective actions as resolved and
 * logged as a repair."
 *
 * ── Why this matches on machine + item, not on the pre-trip's id ─────────
 *
 * The obvious implementation resolves actions whose source_id is the
 * linked pre-trip. That closes the exact case in the sentence above and
 * misses the one that actually bites: a defect flagged on Tuesday that
 * nobody actioned, still open on Thursday, fixed on Thursday's post-trip.
 * Keyed to one pre-trip, Thursday's fix closes Thursday's action and leaves
 * Tuesday's open forever — the supervisor's list slowly fills with defects
 * that were repaired weeks ago, which is how a list stops being read.
 *
 * Matching on (machine, item) says "this fault on this machine is gone",
 * which is the claim the worker is actually making.
 *
 * Best-effort like everything else here, and returns the ids it closed so
 * the caller can log the matching repair against them.
 */
export async function resolveCorrectiveActionsForItems(supabaseAdmin, {
  companyId,
  equipmentId = null,
  equipmentLabel = null,
  itemKeys,
  resolvedBy = null,
  note = null,
  resolutionSource = 'posttrip',
}) {
  try {
    if (!companyId) return [];
    const keys = [...new Set((Array.isArray(itemKeys) ? itemKeys : [itemKeys]).map(normalizeItemKey).filter(Boolean))];
    if (keys.length === 0) return [];
    // With neither an id nor a label there is no machine to scope to, and an
    // unscoped resolve would close another machine's identically-named
    // defect. Fail closed.
    if (equipmentId == null && !cleanLabel(equipmentLabel)) return [];

    // Read narrow, then match the machine in JS with the SAME machineKey()
    // that server-lib/recurrence.js counts with.
    //
    // The obvious version filters the machine in the query —
    // `.eq('equipment_id', id)` or `.eq('equipment_label', label)`. It is
    // wrong twice, and found by tenant-scope-reviewer:
    //
    //   * equipment_label is written on EVERY equipment-sourced row,
    //     including ones that also carry a real equipment_id. So a worker
    //     who skips the fleet dropdown and types "Kenworth T800" would close
    //     the registered Unit 7's open defects — and no repair line would be
    //     written for them, because that path needs an equipment_id. The
    //     action vanishes off the supervisor's list with nothing behind it.
    //   * `.eq` on the label is an EXACT string match while machineKey()
    //     normalizes case and whitespace. "kenworth  t800" would count
    //     toward a recurrence group it could never close — closing and
    //     counting would be using two different definitions of "the same
    //     machine", which is how the two drift apart silently.
    //
    // The read is already narrow (one company, one source type, unresolved,
    // and an explicit list of item keys), so filtering the machine in JS
    // costs almost nothing and buys one definition instead of two.
    const { data: openRows, error: readErr } = await supabaseAdmin
      .from('corrective_actions')
      .select('id, description, item_key, equipment_id, equipment_label, company_id')
      .eq('company_id', companyId)
      .eq('source_type', 'equipment_inspection')
      .neq('status', 'resolved')
      .in('item_key', keys);
    if (readErr) {
      if (isMissingColumnError(readErr)) {
        console.error('resolveCorrectiveActionsForItems: equipment/item columns missing — apply corrective-actions-equipment-recurrence-migration.sql');
        return [];
      }
      console.error('resolveCorrectiveActionsForItems: could not read open actions', readErr.message);
      return [];
    }
    const wantedMachine = machineKey({ company_id: companyId, equipment_id: equipmentId, equipment_label: equipmentLabel });
    if (!wantedMachine) return [];
    const matched = (openRows || []).filter((r) => machineKey(r) === wantedMachine);
    const ids = matched.map((r) => r.id);
    if (ids.length === 0) return [];

    const { error: updateErr } = await supabaseAdmin
      .from('corrective_actions')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_note: cleanDescription(note),
        resolved_by: cleanLabel(resolvedBy),
        resolution_source: resolutionSource,
      })
      .in('id', ids);
    if (updateErr) {
      console.error('resolveCorrectiveActionsForItems: update failed', updateErr.message);
      return [];
    }
    return matched;
  } catch (e) {
    console.error('resolveCorrectiveActionsForItems: unexpected failure', e.message);
    return [];
  }
}

/**
 * Pulls the corrective actions an incident or near-miss report already
 * carries. These are AI-drafted and then edited by whoever wrote the report,
 * so they are the company's own words, not the model's alone.
 */
export function correctiveActionsFromReport(reportJson) {
  const list = reportJson && Array.isArray(reportJson.correctiveActions) ? reportJson.correctiveActions : [];
  return list.map(cleanDescription).filter(Boolean);
}

/**
 * Turns an equipment inspection's failed checklist items into findings.
 *
 * Only Defective items become actions. "Monitor" is explicitly not a
 * corrective action — it is an operator saying "watch this", and opening a
 * tracked, assignable item for every one of them would bury the genuine
 * defects. Monitor items still reach the Brain as signals and still show on
 * the inspection itself.
 *
 * Works unchanged for a post-trip. That is the entire fix for the break
 * Dillon hit: this function has always read `results.items`, and a post-trip
 * never had one — its results_json held a single {hasChanges,
 * changeCondition, changeNotes} blob. So a defect found at the END of a
 * shift produced no corrective action at all, silently, while the same
 * defect found at the start produced one. Now that src/Inspection.jsx runs
 * the same checklist on both, both sides of the trip behave the same way.
 *
 * Returns {description, itemKey} rather than a bare string: the description
 * is what a supervisor reads, the item key is what recurrence counting and
 * post-trip resolution match on. They have to be separate — the description
 * carries the machine label and the operator's note, both of which differ
 * every single time the same fault is reported.
 */
export function correctiveActionsFromInspection(resultsJson, equipmentLabel) {
  const results = resultsJson && typeof resultsJson === 'object' ? resultsJson : null;
  if (!results) return [];
  const items = Array.isArray(results.items) ? results.items : [];
  const machine = cleanLabel(equipmentLabel);

  return items
    .filter((i) => i && i.condition === 'Defective' && typeof i.item === 'string' && i.item.trim())
    // A carried-forward item that was ALREADY Defective on the pre-trip has
    // an open action from the pre-trip. Opening a second one on the
    // post-trip would double every unfixed defect, and — worse — would push
    // one stubborn fault over the 3-in-90-days pattern threshold in a single
    // day, which is the opposite of what a pattern means.
    //
    // A carried item that was only 'Monitor' on the pre-trip and came back
    // Defective is NOT skipped: nothing opened an action for it, and it has
    // genuinely deteriorated during the shift.
    .filter((i) => !(i.carriedFrom && i.carriedCondition === 'Defective'))
    .map((i) => {
      const note = typeof i.note === 'string' && i.note.trim() ? ` — ${i.note.trim()}` : '';
      // A trailer's defect must not read as the tow vehicle's. The checklist
      // already tags each item with the unit it belongs to (see
      // generateInspection() in src/Inspection.jsx), and that tag is what
      // makes the label here correct rather than merely present.
      const where = i.unitLabel && typeof i.unitLabel === 'string' && i.unitLabel.trim()
        ? `${i.unitLabel.trim().slice(0, 120)}: `
        : (machine ? `${machine}: ` : '');
      return {
        description: cleanDescription(`${where}${i.item.trim()}${note}`),
        itemKey: normalizeItemKey(i.item),
      };
    })
    .filter((f) => f.description);
}

/**
 * The checklist items a post-trip says are fixed — the resolution half of
 * the same form.
 *
 * A carried-forward item is one the linked pre-trip flagged. The worker
 * answers it with 'fixed', 'still_open' or 'worse'; only 'fixed' closes
 * anything. 'worse' deliberately does NOT close and does not open a second
 * action either — the existing open action is the right row, and a defect
 * getting worse is a note on it, not a new finding to age separately.
 */
export function resolvedItemsFromPosttrip(resultsJson) {
  const results = resultsJson && typeof resultsJson === 'object' ? resultsJson : null;
  if (!results) return [];
  const items = Array.isArray(results.items) ? results.items : [];
  return items
    .filter((i) => i && i.carriedFrom && i.resolution === 'fixed' && typeof i.item === 'string' && i.item.trim())
    .map((i) => ({
      itemKey: normalizeItemKey(i.item),
      item: i.item.trim(),
      note: typeof i.resolutionNote === 'string' ? i.resolutionNote.trim() : '',
    }))
    .filter((r) => r.itemKey);
}
