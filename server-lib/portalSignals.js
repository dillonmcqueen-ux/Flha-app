// server-lib/portalSignals.js
// What Company Portal tells the Company Brain (docs/scope-company-brain.md,
// map break #4's Portal half). Two inputs, both metadata only:
//
//   1. portal_escalation: one company_signals row each time a submitted
//      answer trips a question's escalation rule. Carries the document
//      title, the question label and the receiving department. Never the
//      answer value, never the worker, never the free text.
//   2. Assignment health: completion and overdue counts per department,
//      computed when the daily Brain summary runs, from portal_assignments
//      and portal_records. Not stored per event, because a rate is not an
//      event. Counts only, no names.
//
// Document titles and question labels are authored in FORA's document
// builder, not typed by workers, but they are still capped and stripped to a
// single line here because they end up inside a model prompt.

const DEPARTMENT_LABEL = { hr: 'HR', payroll: 'Payroll', safety: 'Safety', maintenance: 'Maintenance', operations_manager: 'Operations Manager' };

function oneLine(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

// Returns null when there is nothing usable to learn from.
export function portalEscalationSignal({ documentTitle, questionText, department } = {}) {
  const question = oneLine(questionText, 120);
  const doc = oneLine(documentTitle, 80);
  const dept = Object.prototype.hasOwnProperty.call(DEPARTMENT_LABEL, department) ? department : null;
  if (!question || !doc || !dept) return null;
  return { document: doc, question, department: dept };
}

// Pure. `assignments` rows need document_id, roster_id, due_at, created_at.
// `records` rows need document_id, submitted_by_roster_id, created_at.
// `activeRosterIds` is the set of people still on the roster, so a former
// employee's untouched assignment does not drag a rate down forever, which
// is the same rule get_assignment_rollup applies in api/portal.js.
export function summarizePortalHealth({ documents = [], assignments = [], records = [], activeRosterIds = new Set(), now = new Date() } = {}) {
  const docById = new Map(documents.map((d) => [d.id, d]));
  const byDept = {};
  for (const a of assignments) {
    const doc = docById.get(a.document_id);
    if (!doc || !activeRosterIds.has(a.roster_id)) continue;
    const done = records.some((r) => r.document_id === a.document_id
      && r.submitted_by_roster_id === a.roster_id
      && new Date(r.created_at) >= new Date(a.created_at));
    const overdue = !done && a.due_at && new Date(a.due_at) < now;
    for (const dep of (doc.departments || [])) {
      if (!Object.prototype.hasOwnProperty.call(DEPARTMENT_LABEL, dep)) continue;
      if (!byDept[dep]) byDept[dep] = { assigned: 0, completed: 0, overdue: 0 };
      byDept[dep].assigned += 1;
      if (done) byDept[dep].completed += 1;
      if (overdue) byDept[dep].overdue += 1;
    }
  }
  return Object.entries(byDept)
    .map(([dep, s]) => ({ department: dep, label: DEPARTMENT_LABEL[dep], ...s }))
    .sort((a, b) => b.overdue - a.overdue || b.assigned - a.assigned);
}

export function healthLines(rows) {
  return rows.map((r) => `- Portal assignments, ${r.label}: ${r.completed} of ${r.assigned} completed${r.overdue ? `, ${r.overdue} overdue` : ''}`);
}

// Aggregates escalation signals so a repeat issue reads as a count, not as
// the same line forty times. Pure.
export function escalationLines(signals) {
  const counts = new Map();
  for (const s of signals) {
    const j = s.signal_json || {};
    if (!j.question || !j.document) continue;
    const key = `${j.document}\u0000${j.question}\u0000${j.department || ''}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key, n]) => {
      const [document, question, department] = key.split('\u0000');
      return `- Portal flagged answer${n > 1 ? ` (x${n})` : ''}: "${question}" on "${document}", routed to ${DEPARTMENT_LABEL[department] || 'a department'}`;
    });
}

// Loader. Every read is filtered by the company id the caller already
// resolved; nothing here trusts a client value. Returns [] on any failure or
// when the company has no Portal documents, so the Brain summary never
// depends on it.
export async function loadPortalHealthLines(supabaseAdmin, companyId) {
  try {
    const { data: documents, error: docErr } = await supabaseAdmin
      .from('portal_documents').select('id, departments').eq('company_id', companyId);
    if (docErr || !documents || documents.length === 0) return [];
    const docIds = documents.map((d) => d.id);
    const { data: assignments } = await supabaseAdmin
      .from('portal_assignments').select('document_id, roster_id, due_at, created_at').in('document_id', docIds);
    if (!assignments || assignments.length === 0) return [];
    const { data: rosterRows } = await supabaseAdmin
      .from('roster').select('id').eq('company_id', companyId).eq('active', true);
    const { data: records } = await supabaseAdmin
      .from('portal_records').select('document_id, submitted_by_roster_id, created_at').in('document_id', docIds);
    return healthLines(summarizePortalHealth({
      documents, assignments, records: records || [],
      activeRosterIds: new Set((rosterRows || []).map((r) => r.id)),
    }));
  } catch (e) {
    console.error('portal health lines failed for company', companyId, e.message);
    return [];
  }
}
