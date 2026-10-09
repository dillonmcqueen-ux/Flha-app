// Pure state helpers for the document builder (WP6): the field list, the
// rules and the routing preview text. No React, no network. Fields use the
// database row shape (field_key, field_type, ...) and are mapped to what
// saveDraft accepts by builderApi.fieldsForSave.

import { ENGINE_FIELD_TYPES, fieldTypeNeedsOptions, fieldTypeIsIdBearing } from '../../server-lib/documentEngine/fieldTypes.js';
import { slugKey } from '../../server-lib/documentEngine/validate.js';
import { RESOLVABLE_ID_TYPES } from '../../server-lib/documentEngine/idAnswers.js';

export const MAX_FIELDS = 200;
export const DEPARTMENTS = [
  ['hr', 'HR'], ['payroll', 'Payroll'], ['safety', 'Safety'], ['maintenance', 'Maintenance'], ['operations_manager', 'Operations Manager'],
];
export const DEPARTMENT_LABEL = Object.fromEntries(DEPARTMENTS);
export const ROUTABLE_TYPES = ['yesno', 'dropdown', 'multiselect', 'condition3'];
export const ATTACHMENT_KINDS = [['image', 'Photos'], ['pdf', 'PDF'], ['word', 'Word'], ['excel', 'Excel']];
export const ATTACHMENT_FIELD_TYPES = ['file_upload', 'photo'];

/** Types a builder may add. A type workers cannot answer yet is flagged (none today besides crew signatures, which are not offered). */
export const BUILDER_FIELD_TYPES = ENGINE_FIELD_TYPES
  .filter((t) => t.key !== 'crew_signatures')
  .map((t) => ({ key: t.key, label: t.label, needsOptions: !!t.needsOptions, notYet: fieldTypeIsIdBearing(t.key) && !RESOLVABLE_ID_TYPES.includes(t.key) }));

const uniqueKey = (fields, base) => {
  const used = new Set(fields.map((f) => f.field_key));
  let key = slugKey(base) || 'field';
  if (!used.has(key)) return key;
  let n = 2;
  while (used.has(`${key}_${n}`.slice(0, 60))) n += 1;
  return `${key}_${n}`.slice(0, 60);
};

export function newField(fields, fieldType, label = '') {
  const text = label || (BUILDER_FIELD_TYPES.find((t) => t.key === fieldType)?.label || 'Field');
  return {
    field_key: uniqueKey(fields, text), label: text, field_type: fieldType,
    config: fieldTypeNeedsOptions(fieldType) ? { options: ['Option 1', 'Option 2'] } : {},
    required: false, section: null, help_text: null, attachment_rules: {},
  };
}

export function addField(fields, fieldType, label) {
  if (fields.length >= MAX_FIELDS) return { fields, error: `A document can have at most ${MAX_FIELDS} fields.` };
  const f = newField(fields, fieldType, label);
  return { fields: [...fields, f], key: f.field_key };
}

export const removeField = (fields, key) => fields.filter((f) => f.field_key !== key);

export function moveField(fields, key, delta) {
  const i = fields.findIndex((f) => f.field_key === key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= fields.length) return fields;
  const next = fields.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Changing a field's type resets what only the old type understood. The key never changes after a save. */
export function updateField(fields, key, patch) {
  return fields.map((f) => {
    if (f.field_key !== key) return f;
    const next = { ...f, ...patch, field_key: f.field_key };
    if (patch.field_type && patch.field_type !== f.field_type) {
      next.config = fieldTypeNeedsOptions(patch.field_type) ? { options: (f.config?.options?.length >= 2 ? f.config.options : ['Option 1', 'Option 2']) } : {};
      if (!ATTACHMENT_FIELD_TYPES.includes(patch.field_type)) next.attachment_rules = {};
    }
    return next;
  });
}

export const setOptions = (fields, key, options) => updateField(fields, key, { config: { options } });

/** Where a field is still used, so removing it can warn instead of breaking silently. */
export function fieldUsage(key, layout, rules) {
  const where = [];
  for (const b of layout?.blocks || []) {
    if (b.field === key || (Array.isArray(b.fields) && b.fields.includes(key))) where.push(`layout block ${b.id}`);
    if (b.showIf?.answer === key) where.push(`a show condition on ${b.id}`);
  }
  for (const r of rules || []) if (r.rule_type === 'route_by_answer' && r.config?.fieldKey === key) where.push('a routing rule');
  return where;
}

/** Problems worth showing before a save. The server still has the last word. */
export function fieldProblems(fields) {
  const out = [];
  if (fields.length === 0) out.push('Add at least one field.');
  for (const f of fields) {
    if (!String(f.label || '').trim()) out.push(`A ${f.field_type} field has no label.`);
    if (fieldTypeNeedsOptions(f.field_type) && (f.config?.options || []).filter((o) => String(o).trim()).length < 2) out.push(`"${f.label}" needs at least two options.`);
  }
  return out;
}

// ── Rules ────────────────────────────────────────────────────────────────

export const emptyRulesView = () => ({
  signatureRequired: false, reviewers: [], notifyDepartments: [], scopeDepartments: [], routes: [], other: [],
});

/** Rule rows (database or saved shape) into the structure the screens edit. */
export function rulesToView(rows) {
  const v = emptyRulesView();
  const list = (rows || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const r of list) {
    const c = r.config || {};
    if (r.rule_type === 'signature_step') { if (c.signer === 'worker') v.signatureRequired = true; else v.other.push(r); }
    else if (r.rule_type === 'reviewer_step') v.reviewers.push({ label: c.label || '', role: c.role === 'owner' ? 'owner' : 'supervisor', allowLeads: c.allowLeads === true, distinct: c.distinct !== false });
    else if (r.rule_type === 'notify') { v.notifyDepartments.push(...(c.departments || [])); if (Array.isArray(c.extraRosterIds) && c.extraRosterIds.length) v.other.push({ rule_type: 'notify', config: { extraRosterIds: c.extraRosterIds } }); }
    else if (r.rule_type === 'route_by_scope') v.scopeDepartments.push(...(c.departments || []));
    else if (r.rule_type === 'route_by_answer') v.routes.push({ fieldKey: c.fieldKey || '', equals: Array.isArray(c.equals) ? c.equals.map(String) : (c.equals != null ? [String(c.equals)] : []), department: c.department || '' });
    else v.other.push(r);
  }
  v.notifyDepartments = [...new Set(v.notifyDepartments)];
  v.scopeDepartments = [...new Set(v.scopeDepartments)];
  return v;
}

/** The editable structure back into rule rows. Rules the builder does not edit are kept as they were. */
export function viewToRules(v) {
  const rules = [];
  if (v.signatureRequired) rules.push({ rule_type: 'signature_step', config: { signer: 'worker' } });
  for (const s of v.reviewers) {
    const config = { role: s.role === 'owner' ? 'owner' : 'supervisor' };
    if (s.label && s.label.trim()) config.label = s.label.trim().slice(0, 80);
    if (s.allowLeads) config.allowLeads = true;
    if (s.distinct === false) config.distinct = false;
    rules.push({ rule_type: 'reviewer_step', config });
  }
  if (v.notifyDepartments.length) rules.push({ rule_type: 'notify', config: { departments: v.notifyDepartments } });
  if (v.scopeDepartments.length) rules.push({ rule_type: 'route_by_scope', config: { departments: v.scopeDepartments } });
  for (const r of v.routes) if (r.fieldKey && r.equals.length && r.department) rules.push({ rule_type: 'route_by_answer', config: { fieldKey: r.fieldKey, equals: r.equals, department: r.department } });
  for (const o of v.other) rules.push({ rule_type: o.rule_type, config: o.config || {} });
  return rules.map((r, i) => ({ ...r, sort_order: i }));
}

export function rulesProblems(v, fields) {
  const out = [];
  const byKey = new Map(fields.map((f) => [f.field_key, f]));
  v.routes.forEach((r, i) => {
    const f = byKey.get(r.fieldKey);
    if (!r.fieldKey || !f) out.push(`Routing rule ${i + 1} needs a field.`);
    else if (!ROUTABLE_TYPES.includes(f.field_type)) out.push(`"${f.label}" cannot route. Only Yes/No, Dropdown, Multi-select and Good/Monitor/Defective can.`);
    if (!r.equals.length) out.push(`Routing rule ${i + 1} needs an answer to match.`);
    if (!r.department) out.push(`Routing rule ${i + 1} needs a department.`);
  });
  return out;
}

/** Plain-English routing preview: what happens from submit to done. */
export function routingSummary(v, fields) {
  const label = (d) => DEPARTMENT_LABEL[d] || d;
  const byKey = new Map(fields.map((f) => [f.field_key, f]));
  const lines = [];
  lines.push({ step: 'Worker fills the form', detail: v.signatureRequired ? 'The worker signs it, now or later. An unsigned document alerts after 24 hours and closes after 10 days.' : 'No worker signature is required.' });
  const told = [...new Set([...v.notifyDepartments, ...v.scopeDepartments])].map(label);
  const announces = told.length > 0 || v.reviewers.length > 0;
  lines.push({ step: 'On submit', detail: announces ? `Notified: ${told.length ? told.join(', ') : 'the reviewers'}${told.length && v.reviewers.length ? ' and the reviewers' : ''}.` : 'Nobody is notified. The record only appears in the document list.' });
  for (const r of v.routes) {
    const f = byKey.get(r.fieldKey);
    if (f) lines.push({ step: 'Escalation', detail: `If "${f.label}" is ${r.equals.join(' or ')}, ${label(r.department)} is told and gets an escalation to action.` });
  }
  v.reviewers.forEach((s, i) => {
    const who = s.role === 'owner' ? 'the Account Owner' : `a supervisor${s.allowLeads ? ' or the crew lead' : ''}`;
    lines.push({ step: s.label || `Review ${i + 1}`, detail: `Signed off by ${who}. They cannot review their own document${s.distinct === false ? '' : ' and cannot take two steps'}. A reviewer can send it back to the worker.` });
  });
  if (v.reviewers.length) lines.push({ step: 'Stale review', detail: 'A review pending 48 hours is escalated to the Account Owner.' });
  lines.push({ step: 'Done', detail: v.reviewers.length ? 'Approved after the last step.' : 'Filed on submit.' });
  return lines;
}
