// server-lib/assignmentAdmin.js
// The Owner's side of document assignments: what can be assigned, validating
// a new assignment, and showing each one with how many people it reaches.
// Reading and enforcement live in server-lib/documentAccess.js.
//
// Everything here takes the company id from the caller (the handler resolves
// it from the session), and every id that arrives from a client is checked
// against that company: a custom form, Portal document, division, site or
// roster id from another company is a tenancy question, not a validation
// detail.
//
// The count matters as much as the validation. An assignment that names an
// empty audience (a department nobody holds, a site with nobody at it)
// narrows its document to NOBODY, which silently switches the document off
// for everyone but the Owner. The list shows "reaches N people" so a zero is
// visible before anyone files a form and finds out.

import { isAssignableAction, matchesAudience, SUBMIT, VIEW } from './documentAccess.js';
import { validDepartmentKeys, listDivisions } from './companyStructure.js';

export const BUILTIN_DOCUMENT_LABELS = {
  flha: 'FLHA',
  inspection: 'Equipment Inspection',
  toolbox: 'Toolbox Talk',
  nearmiss: 'Near Miss Report',
  incident: 'Incident Report',
  daily: 'Daily Report',
  monthly: 'Monthly Inspection',
  fuellog: 'Fuel Log',
};

export const AUDIENCE_TYPES = ['everyone', 'role', 'department', 'division', 'site', 'individual'];
export const ASSIGNABLE_ROLES = ['worker', 'supervisor'];
export const MAX_ACTIVE_ASSIGNMENTS = 500;

/**
 * Every document this company can assign: the built-ins it has switched on,
 * its own custom forms and its Portal documents.
 * Returns [{ key, label, kind, actions }].
 */
export async function listAssignableDocuments(supabase, companyId) {
  const [{ data: settings }, { data: customForms }, { data: portalDocs }] = await Promise.all([
    supabase.from('company_document_settings').select('document_key, is_active').eq('company_id', companyId),
    supabase.from('custom_forms').select('id, title').eq('company_id', companyId).eq('is_active', true).order('created_at', { ascending: true }),
    supabase.from('portal_documents').select('id, title').eq('company_id', companyId).eq('is_active', true).order('created_at', { ascending: true }),
  ]);
  const on = new Set((settings || []).filter((s) => s.is_active === true).map((s) => s.document_key));
  const off = new Set((settings || []).filter((s) => s.is_active === false).map((s) => s.document_key));
  const docs = [];
  for (const [key, label] of Object.entries(BUILTIN_DOCUMENT_LABELS)) {
    if (on.has(key)) docs.push({ key, label, kind: 'builtin', actions: [SUBMIT, VIEW] });
  }
  for (const f of customForms || []) {
    if (off.has(`custom_${f.id}`)) continue;
    docs.push({ key: `custom_${f.id}`, label: f.title, kind: 'custom', actions: [SUBMIT, VIEW] });
  }
  for (const d of portalDocs || []) {
    docs.push({ key: `portal_${d.id}`, label: d.title, kind: 'portal', actions: [SUBMIT] });
  }
  return docs;
}

function parseDueAt(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return { error: 'Enter a valid due date.' };
  return { value: new Date(t).toISOString() };
}

/**
 * Validates a client-supplied assignment for one company.
 * Returns `{ row }` (ready to insert, minus company_id and created_by) or
 * `{ error, status }`.
 */
export async function validateAssignment(supabase, companyId, input) {
  const documentKey = String(input.documentKey || '');
  const action = String(input.action || '');
  const audienceType = String(input.audienceType || '');
  if (!isAssignableAction(documentKey, action)) {
    return { status: 400, error: documentKey.startsWith('portal_') && action === VIEW
      ? 'Portal documents can be assigned to submit only.'
      : "That document can't be assigned." };
  }
  if (!AUDIENCE_TYPES.includes(audienceType)) return { status: 400, error: 'Pick who this is for.' };

  const docs = await listAssignableDocuments(supabase, companyId);
  const doc = docs.find((d) => d.key === documentKey);
  if (!doc) return { status: 400, error: "That document isn't available to this company." };

  let audienceValue = null;
  const raw = input.audienceValue === undefined || input.audienceValue === null ? '' : String(input.audienceValue);
  if (audienceType === 'role') {
    if (!ASSIGNABLE_ROLES.includes(raw)) return { status: 400, error: 'Pick a role.' };
    audienceValue = raw;
  } else if (audienceType === 'department') {
    const valid = await validDepartmentKeys(supabase, companyId);
    if (!valid.has(raw)) return { status: 400, error: 'Pick one of your departments.' };
    audienceValue = raw;
  } else if (audienceType === 'division') {
    const id = Number(raw);
    const have = new Set((await listDivisions(supabase, companyId)).map((d) => d.id));
    if (!Number.isInteger(id) || !have.has(id)) return { status: 400, error: 'Pick one of your divisions.' };
    audienceValue = String(id);
  } else if (audienceType === 'site') {
    const id = Number(raw);
    if (!Number.isInteger(id)) return { status: 400, error: 'Pick a site.' };
    const { data: rows } = await supabase.from('sites').select('id').eq('id', id).eq('company_id', companyId).limit(1);
    if (!rows || rows.length === 0) return { status: 400, error: 'Pick one of your sites.' };
    audienceValue = String(id);
  } else if (audienceType === 'individual') {
    const id = Number(raw);
    if (!Number.isInteger(id)) return { status: 400, error: 'Pick a person.' };
    const { data: rows } = await supabase.from('roster').select('id, active').eq('id', id).eq('company_id', companyId).limit(1);
    if (!rows || rows.length === 0 || rows[0].active !== true) return { status: 400, error: 'Pick someone on your roster.' };
    audienceValue = String(id);
  }

  const due = parseDueAt(input.dueAt);
  if (due.error) return { status: 400, error: due.error };
  if (due.value && action === VIEW) return { status: 400, error: 'Only a submit assignment has a due date.' };

  return { row: { document_key: documentKey, audience_type: audienceType, audience_value: audienceValue, action, due_at: due.value } };
}

/**
 * The company's active assignments, each with `reaches`: how many active
 * people the audience names right now. `people` is roster rows
 * ({ id, role, departments, divisions, default_site_id }) and `siteDivision`
 * maps site id -> division id.
 */
export function describeAssignments(rows, people, siteDivision) {
  const actors = people.map((p) => {
    const divisionIds = (p.divisions || []).map(Number);
    const siteIds = new Set();
    if (p.default_site_id != null) siteIds.add(Number(p.default_site_id));
    for (const [siteId, divId] of siteDivision) if (divId != null && divisionIds.includes(Number(divId))) siteIds.add(Number(siteId));
    return { rosterId: Number(p.id), role: p.role, departments: p.departments || [], divisionIds, siteIds };
  });
  return rows.map((r) => ({
    id: r.id,
    documentKey: r.document_key,
    audienceType: r.audience_type,
    audienceValue: r.audience_value,
    action: r.action,
    dueAt: r.due_at,
    createdAt: r.created_at,
    reaches: actors.filter((a) => matchesAudience(r, a)).length,
  }));
}

/**
 * When a department, division, site or person an assignment names goes away,
 * end the assignment. Left alone it would narrow its document to nobody.
 * Best effort: a missing table (migration not applied) or a failed write must
 * never undo the delete that already succeeded.
 */
export async function endAssignmentsForAudience(supabase, companyId, audienceType, audienceValue) {
  try {
    await supabase
      .from('document_assignments')
      .update({ ended_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('audience_type', audienceType)
      .eq('audience_value', String(audienceValue))
      .is('ended_at', null);
  } catch (e) {
    console.error('could not end assignments for removed audience:', e.message);
  }
}
