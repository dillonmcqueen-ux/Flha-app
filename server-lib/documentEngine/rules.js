// server-lib/documentEngine/rules.js
// Reading a version's rules, and the pure decisions made from them (WP3).
// No database here. server-lib/documentEngine/service.js loads the rows and
// calls these; everything that can be decided without a query is decided
// here so it can be tested directly.
//
// Rule types and their config (stored in document_rules.config):
//
//   signature_step    { signer: 'worker' }  a worker signature is required
//   reviewer_step     { label?, allowLeads?, role? }  one step of the reviewer
//                     chain. Steps run in sort order. role 'owner' limits the
//                     step to the Account Owner and the founder. allowLeads
//                     lets a crew lead act on records written by their crew.
//                     distinct (default true): the same person cannot review
//                     two steps of one record.
//   notify            { extraRosterIds?: number[], departments?: string[] }
//                     who is told on submit, on top of whoever the scope rules
//                     already place the record with.
//   route_by_answer   { fieldKey, equals: string | string[], department }
//                     an answer that equals one of the values escalates the
//                     record to that department.
//   route_by_scope    { departments: string[] }  also tell supervisors in
//                     these departments about every new record.
//   corrective_action not acted on yet (arrives with equipment inspection)

import { fieldTypeInfo } from './fieldTypes.js';

const ids = (v) => (Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const strings = (v) => (Array.isArray(v) ? v : []).map((s) => String(s)).filter(Boolean);
const ofType = (rules, type) => (rules || []).filter((r) => r.rule_type === type)
  .sort((a, b) => (a.sort_order - b.sort_order) || ((a.id || 0) - (b.id || 0)));

/** The reviewer chain, in order. Empty when the document needs no review. */
export function reviewSteps(rules) {
  return ofType(rules, 'reviewer_step').map((r, index) => ({
    index,
    label: typeof r.config?.label === 'string' && r.config.label.trim() ? r.config.label.trim().slice(0, 80) : `Review ${index + 1}`,
    role: r.config?.role === 'owner' ? 'owner' : 'supervisor',
    allowLeads: r.config?.allowLeads === true,
    distinct: r.config?.distinct !== false,
  }));
}

export function needsWorkerSignature(rules) {
  return ofType(rules, 'signature_step').some((r) => r.config?.signer === 'worker');
}

/**
 * Who is told about a new record. A document is announced when its builder
 * added a notify rule or a reviewer step (reviewers must hear they have
 * something to review). Returns { announce, extraRosterIds, departments }.
 */
export function notifyPlan(rules) {
  const notify = ofType(rules, 'notify');
  const scope = ofType(rules, 'route_by_scope');
  const hasReview = reviewSteps(rules).length > 0;
  return {
    announce: notify.length > 0 || hasReview || scope.length > 0,
    extraRosterIds: [...new Set(notify.flatMap((r) => ids(r.config?.extraRosterIds)))],
    departments: [...new Set([...notify.flatMap((r) => strings(r.config?.departments)), ...scope.flatMap((r) => strings(r.config?.departments))])],
  };
}

export function answerRoutes(rules) {
  return ofType(rules, 'route_by_answer')
    .map((r) => ({
      fieldKey: typeof r.config?.fieldKey === 'string' ? r.config.fieldKey : '',
      equals: strings(Array.isArray(r.config?.equals) ? r.config.equals : [r.config?.equals]),
      department: typeof r.config?.department === 'string' ? r.config.department : '',
    }))
    .filter((r) => r.fieldKey && r.equals.length > 0 && r.department);
}

// The answer as comparable strings: a yes/no or dropdown answer is one, a
// multiselect is each option picked.
function comparable(row) {
  if (row.value_json != null && Array.isArray(row.value_json)) return row.value_json.map((v) => String(v).toLowerCase());
  if (row.value_text != null) return [String(row.value_text).toLowerCase()];
  return [];
}

/**
 * Which answers trip a route_by_answer rule. `answerRows` are the validated
 * rows (field_key, question_text, value_text, value_json). Only fields that
 * have a fixed set of possible answers can route, so free text never does.
 * Returns [{ fieldKey, question, value, department }], one per field.
 */
export function matchRoutes(routes, answerRows) {
  const byKey = new Map(answerRows.map((r) => [r.field_key, r]));
  const out = [];
  const seen = new Set();
  for (const route of routes) {
    const row = byKey.get(route.fieldKey);
    if (!row || seen.has(route.fieldKey)) continue;
    const info = fieldTypeInfo(row.field_type);
    if (!info || !['yesno', 'dropdown', 'multiselect', 'condition3'].includes(row.field_type)) continue;
    const have = comparable(row);
    const hit = route.equals.find((e) => have.includes(e.toLowerCase()));
    if (hit == null) continue;
    seen.add(route.fieldKey);
    out.push({ fieldKey: route.fieldKey, question: row.question_text, value: hit, department: route.department });
  }
  return out;
}

/**
 * May this person act on the current review step? Pure: the caller loads the
 * facts. Returns { ok: true } or { ok: false, status, error }.
 *
 *   actor      { founder, bypass (Owner), rosterId, role, isLead }
 *   record     { submitted_by_roster_id }
 *   step       one entry of reviewSteps()
 *   crew       { ids: Set, leadIds: Set } for a lead, else null
 *   priorReviewerIds  roster ids that already signed an earlier step
 */
export function reviewerMayAct({ actor, record, step, crew, priorReviewerIds = [] }) {
  const denied = { ok: false, status: 403, error: 'Not allowed.' };
  if (!actor || !step) return denied;
  const authorId = record.submitted_by_roster_id != null ? Number(record.submitted_by_roster_id) : null;
  if (actor.rosterId != null && authorId != null && authorId === actor.rosterId) {
    return { ok: false, status: 403, error: 'You cannot review your own document.' };
  }
  if (step.distinct && actor.rosterId != null && priorReviewerIds.map(Number).includes(actor.rosterId)) {
    return { ok: false, status: 403, error: 'A different person has to review each step.' };
  }
  if (actor.founder === true) return { ok: true };
  if (step.role === 'owner') return actor.bypass === true ? { ok: true } : denied;
  if (actor.role === 'supervisor' || actor.role === 'admin') return { ok: true };

  // A worker flagged as a crew lead, on a step that allows it.
  if (actor.role === 'worker' && actor.isLead === true && step.allowLeads) {
    if (!crew || authorId == null) return denied;
    if (!crew.ids.has(authorId)) return denied;
    if (crew.leadIds.has(authorId)) {
      return { ok: false, status: 403, error: "A crew lead's document needs a supervisor to review it." };
    }
    return { ok: true };
  }
  return denied;
}

// Only fields with a fixed set of possible answers go to the Brain. Free
// text never does, and neither does the author.
const BRAIN_TYPES = ['yesno', 'dropdown', 'multiselect', 'condition3'];

/**
 * The metadata-only Brain signal for one filed document, or null when there
 * is nothing worth learning. Document title and question labels are authored
 * in the builder; answers are limited to option-based fields.
 */
export function brainSignalFor({ title, answerRows, escalations = [] }) {
  const clean = (s, n) => String(s || '').replace(/["“”]/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const doc = clean(title, 80);
  if (!doc) return null;
  const answers = [];
  for (const row of answerRows) {
    if (!BRAIN_TYPES.includes(row.field_type)) continue;
    const value = Array.isArray(row.value_json) ? row.value_json.join(', ') : row.value_text;
    if (value == null || value === '') continue;
    answers.push({ question: clean(row.question_text, 120), answer: clean(value, 80) });
    if (answers.length >= 12) break;
  }
  const flagged = escalations.slice(0, 6).map((e) => ({ question: clean(e.question, 120), department: clean(e.department, 40) }));
  if (answers.length === 0 && flagged.length === 0) return null;
  return { document: doc, answers, flagged };
}
