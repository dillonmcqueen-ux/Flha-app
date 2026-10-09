// server-lib/documentEngine/fieldTypes.js
// The field types a unified-engine document can use. See
// docs/unified-document-engine-spec.md section 4.2.
//
// The database stores field_type as plain text with no CHECK (see
// docs/schema/document-engine-wp1-migration.sql), so this list is the one
// place a type is declared. Adding a type is a change here, not a migration.
//
// `value` says how an answer is stored on document_answers:
//   text  -> value_text        json -> value_json        file -> file_path

export const ENGINE_FIELD_TYPES = [
  // Carried over from Company Portal (server-lib/portalFieldTypes.js).
  { key: 'yesno', label: 'Yes / No', value: 'text' },
  { key: 'short_text', label: 'Short text', value: 'text' },
  { key: 'long_text', label: 'Long text', value: 'text' },
  { key: 'number', label: 'Number', value: 'text' },
  { key: 'date', label: 'Date', value: 'text' },
  { key: 'dropdown', label: 'Dropdown', value: 'text', needsOptions: true },
  { key: 'multiselect', label: 'Multi-select', value: 'json', needsOptions: true },
  { key: 'signature', label: 'Signature', value: 'file' },
  { key: 'file_upload', label: 'File upload', value: 'file' },
  { key: 'photo', label: 'Photo', value: 'file' },
  // Needed to absorb the built-in documents.
  { key: 'condition3', label: 'Good / Monitor / Defective', value: 'text' },
  { key: 'equipment_picker', label: 'Equipment', value: 'json', idBearing: true },
  { key: 'attachment_picker', label: 'Attachments', value: 'json', idBearing: true },
  { key: 'reading', label: 'Hour or KM reading', value: 'json' },
  { key: 'site_picker', label: 'Site', value: 'json', idBearing: true },
  { key: 'person_picker', label: 'Person', value: 'json', idBearing: true },
  { key: 'quantity_unit', label: 'Quantity and unit', value: 'json' },
  { key: 'section_table', label: 'Table or repeating rows', value: 'json' },
  { key: 'linked_document', label: 'Linked document', value: 'json', idBearing: true },
  // FLHA blocks.
  { key: 'hazard_table', label: 'Hazard table', value: 'json' },
  { key: 'ppe_list', label: 'PPE list', value: 'json' },
  { key: 'crew_signatures', label: 'Crew signatures', value: 'json', idBearing: true },
];

const BY_KEY = Object.fromEntries(ENGINE_FIELD_TYPES.map((t) => [t.key, t]));

// Types whose answer carries ids (equipment, site, roster, record) or
// signature paths. Submitting one is refused until a validator that checks
// every embedded id against the caller's company exists (WP7 for the
// pickers). Storing them unchecked would let a later reader (a PDF, the
// maintenance join, the Brain) follow another company's id. crew_signatures
// is not answered through a field at all: crew sign through the `crew`
// parameter of submit, which is validated against the roster.
export function fieldTypeIsIdBearing(key) {
  return !!(BY_KEY[key] && BY_KEY[key].idBearing);
}

export const ENGINE_FIELD_TYPE_KEYS = ENGINE_FIELD_TYPES.map((t) => t.key);


export function fieldTypeInfo(key) {
  return BY_KEY[key] || null;
}

export function fieldTypeNeedsOptions(key) {
  return !!(BY_KEY[key] && BY_KEY[key].needsOptions);
}

export const CONDITION_VALUES = ['Good', 'Monitor', 'Defective', 'N/A'];

// Rule types the builder may store. WP2 only stores and returns them. The
// engine that acts on them (routing, notifications, corrective actions,
// signature steps) is WP3.
export const ENGINE_RULE_TYPES = [
  'reviewer_step',
  'route_by_answer',
  'route_by_scope',
  'notify',
  'corrective_action',
  'signature_step',
];

export const MAX_SHORT_TEXT = 2000;
export const MAX_LONG_TEXT = 10000;
export const MAX_JSON_BYTES = 100 * 1024;
