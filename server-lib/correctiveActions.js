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

    const wanted = (Array.isArray(descriptions) ? descriptions : [descriptions])
      .map(cleanDescription)
      .filter(Boolean)
      .slice(0, MAX_ACTIONS_PER_SOURCE);
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
    const rows = wanted
      .filter((d) => !already.has(d))
      .map((description) => ({
        company_id: companyId,
        source_type: sourceType,
        source_id: sourceId,
        answer_id: answerId,
        description,
        status: 'open',
      }));
    if (rows.length === 0) return 0;

    const { error } = await supabaseAdmin.from('corrective_actions').insert(rows);
    if (error) {
      console.error('openCorrectiveActions: insert failed', sourceType, sourceId, error.message);
      return 0;
    }
    return rows.length;
  } catch (e) {
    console.error('openCorrectiveActions: unexpected failure', e.message);
    return 0;
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
 * Turns an equipment inspection's failed checklist items into descriptions.
 *
 * Only Defective items become actions. "Monitor" is explicitly not a
 * corrective action — it is an operator saying "watch this", and opening a
 * tracked, assignable item for every one of them would bury the genuine
 * defects. Monitor items still reach the Brain as signals and still show on
 * the inspection itself.
 */
export function correctiveActionsFromInspection(resultsJson, equipmentLabel) {
  const results = resultsJson && typeof resultsJson === 'object' ? resultsJson : null;
  if (!results) return [];
  const items = Array.isArray(results.items) ? results.items : [];
  const machine = typeof equipmentLabel === 'string' && equipmentLabel.trim()
    ? equipmentLabel.trim().slice(0, 120)
    : null;

  return items
    .filter((i) => i && i.condition === 'Defective' && typeof i.item === 'string' && i.item.trim())
    .map((i) => {
      const note = typeof i.note === 'string' && i.note.trim() ? ` — ${i.note.trim()}` : '';
      const where = machine ? `${machine}: ` : '';
      return cleanDescription(`${where}${i.item.trim()}${note}`);
    })
    .filter(Boolean);
}
