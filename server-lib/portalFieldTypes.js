// server-lib/portalFieldTypes.js
//
// The 8 field types Company Portal documents support (FORA Company Portal
// — Build Spec, "Field types and document engine"), generalizing
// api/customforms.js's custom_form_questions, which supports exactly one
// (yes/no + optional note). Shared by server (api/portal.js validates
// against this) and client (the admin builder's field-type picker, the
// worker-facing renderer) — same reasoning as server-lib/portalDepartments.js.
//
// `needsOptions` marks the two types whose answer is chosen from a fixed
// list the document author defines (portal_questions.options) rather than
// free-form input.
export const PORTAL_FIELD_TYPES = [
  { key: 'yesno', label: 'Yes/No + note', needsOptions: false },
  { key: 'short_text', label: 'Short text', needsOptions: false },
  { key: 'number', label: 'Number', needsOptions: false },
  { key: 'date', label: 'Date', needsOptions: false },
  { key: 'dropdown', label: 'Dropdown', needsOptions: true },
  { key: 'multiselect', label: 'Multi-select', needsOptions: true },
  { key: 'signature', label: 'Signature', needsOptions: false },
  { key: 'file_upload', label: 'File upload', needsOptions: false },
];

export const PORTAL_FIELD_TYPE_KEYS = PORTAL_FIELD_TYPES.map(t => t.key);

export const PORTAL_FIELD_TYPE_LABELS = Object.fromEntries(PORTAL_FIELD_TYPES.map(t => [t.key, t.label]));

export function fieldTypeNeedsOptions(fieldType) {
  return PORTAL_FIELD_TYPES.some(t => t.key === fieldType && t.needsOptions);
}

// Phase 5 (question-level escalation): the field types where a submitted
// answer has a single discrete "flagged" value worth comparing against —
// yesno's fixed yes/no, or one option out of a dropdown/multiselect's fixed
// list. short_text/number/date/signature/file_upload have no fixed
// "flagged" value to configure ahead of time, so escalation is never
// offered on them — enforced here so the builder UI and api/portal.js's
// validation can't drift apart on which types allow it.
export const ESCALATABLE_FIELD_TYPES = ['yesno', 'dropdown', 'multiselect'];

export function fieldTypeCanEscalate(fieldType) {
  return ESCALATABLE_FIELD_TYPES.includes(fieldType);
}

// Checks one edited answer value against its question's field type. Returns
// an error string, or null when the value is fine. Signature and file
// answers are not editable (nothing sensible to type into them).
export function validateEditedPortalAnswer(fieldType, questionOptions, value) {
  const options = Array.isArray(questionOptions) ? questionOptions : [];
  switch (fieldType) {
    case 'yesno': return value === 'yes' || value === 'no' ? null : 'Yes/No answers must be yes or no.';
    case 'short_text': return typeof value === 'string' && value.length <= 2000 ? null : 'Text is too long.';
    case 'number': return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? null : 'Enter a number.';
    case 'date': return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : 'Enter a valid date.';
    case 'dropdown': return options.includes(value) ? null : 'Pick one of the listed options.';
    case 'multiselect': return Array.isArray(value) && value.every(v => options.includes(v)) ? null : 'Pick from the listed options.';
    default: return "That answer can't be edited.";
  }
}
