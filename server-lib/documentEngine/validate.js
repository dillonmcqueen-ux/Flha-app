// server-lib/documentEngine/validate.js
// Pure validation for the unified document engine: what a builder may save
// (definition, fields, layout, rules) and what a worker may submit (answers).
// No database and no network, so it is cheap to test and safe to share.
//
// Every function returns `{ ...result }` or `{ error: '...' }`, never throws,
// the same shape server-lib/portalFieldTypes.js uses.

import {
  ENGINE_FIELD_TYPE_KEYS,
  ENGINE_RULE_TYPES,
  CONDITION_VALUES,
  fieldTypeInfo,
  fieldTypeNeedsOptions,
  fieldTypeIsIdBearing,
  MAX_SHORT_TEXT,
  MAX_LONG_TEXT,
  MAX_JSON_BYTES,
} from './fieldTypes.js';

const KEY_RE = /^[a-z0-9_]{1,60}$/;
const MAX_FIELDS = 200;
const MAX_RULES = 100;
const MAX_LAYOUT_BYTES = 200 * 1024;
const ATTACHMENT_KINDS = ['image', 'pdf', 'word', 'excel'];
const MAX_ATTACHMENT_MB = 10;

export function slugKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export function validateDefinitionInput({ title, icon, category, key } = {}) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return { error: 'Give the document a title.' };
  if (cleanTitle.length > 150) return { error: 'The title is too long (150 characters max).' };
  const cleanKey = slugKey(key || cleanTitle);
  if (!KEY_RE.test(cleanKey)) return { error: 'The document key must be letters, numbers and underscores.' };
  return {
    title: cleanTitle,
    key: cleanKey,
    icon: icon ? String(icon).slice(0, 8) : null,
    category: category ? String(category).trim().slice(0, 100) : null,
  };
}

function cleanAttachmentRules(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  if (Array.isArray(raw.allowed)) {
    out.allowed = [...new Set(raw.allowed.filter((a) => ATTACHMENT_KINDS.includes(a)))];
  }
  if (raw.maxMb != null) {
    const n = Number(raw.maxMb);
    if (Number.isFinite(n) && n > 0) out.maxMb = Math.min(n, MAX_ATTACHMENT_MB);
  }
  if (raw.required === true) out.required = true;
  return out;
}

function cleanOptions(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const o of raw) {
    const text = String(o ?? '').trim().slice(0, 200);
    if (text && !seen.has(text)) { seen.add(text); out.push(text); }
  }
  return out.slice(0, 50);
}

/**
 * Validates and normalizes a builder-submitted field list.
 * Each input field: { fieldKey?, label, fieldType, section?, config?,
 * required?, helpText?, attachmentRules? }. A missing fieldKey is made from
 * the label. Order in the array is the sort order.
 */
export function normalizeFields(rawFields) {
  if (!Array.isArray(rawFields) || rawFields.length === 0) return { error: 'Add at least one field.' };
  if (rawFields.length > MAX_FIELDS) return { error: `A document can have at most ${MAX_FIELDS} fields.` };
  const seen = new Set();
  const fields = [];
  for (let i = 0; i < rawFields.length; i += 1) {
    const f = rawFields[i];
    if (!f || typeof f !== 'object') return { error: `Field ${i + 1} is not valid.` };
    const label = String(f.label || '').trim();
    if (!label) return { error: `Field ${i + 1} needs a label.` };
    if (label.length > 300) return { error: `"${label.slice(0, 40)}" is too long (300 characters max).` };
    if (!ENGINE_FIELD_TYPE_KEYS.includes(f.fieldType)) return { error: `Unknown field type: ${f.fieldType}.` };
    let key = f.fieldKey ? String(f.fieldKey) : slugKey(label);
    if (!key) key = `field_${i + 1}`;
    if (!KEY_RE.test(key)) return { error: `"${label}" has an invalid key. Use lowercase letters, numbers and underscores.` };
    if (seen.has(key)) {
      if (f.fieldKey) return { error: `Two fields share the key "${key}".` };
      let n = 2;
      while (seen.has(`${key}_${n}`)) n += 1;
      key = `${key}_${n}`.slice(0, 60);
    }
    seen.add(key);

    const config = f.config && typeof f.config === 'object' && !Array.isArray(f.config) ? { ...f.config } : {};
    if (fieldTypeNeedsOptions(f.fieldType)) {
      config.options = cleanOptions(config.options);
      if (config.options.length < 2) return { error: `"${label}" needs at least two options.` };
    } else {
      delete config.options;
    }
    if (JSON.stringify(config).length > MAX_JSON_BYTES) return { error: `"${label}" has too much configuration.` };

    fields.push({
      field_key: key,
      sort_order: i,
      section: f.section ? String(f.section).trim().slice(0, 150) : null,
      label,
      field_type: f.fieldType,
      config,
      required: f.required === true,
      help_text: f.helpText ? String(f.helpText).slice(0, 1000) : null,
      attachment_rules: cleanAttachmentRules(f.attachmentRules),
    });
  }
  return { fields };
}

export function normalizeLayout(raw) {
  if (raw == null) return { layout: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The layout is not valid.' };
  if (JSON.stringify(raw).length > MAX_LAYOUT_BYTES) return { error: 'The layout is too large.' };
  return { layout: raw };
}

export function normalizeRules(raw) {
  if (raw == null) return { rules: [] };
  if (!Array.isArray(raw)) return { error: 'The rules are not valid.' };
  if (raw.length > MAX_RULES) return { error: `A document can have at most ${MAX_RULES} rules.` };
  const rules = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r = raw[i];
    if (!r || typeof r !== 'object') return { error: `Rule ${i + 1} is not valid.` };
    if (!ENGINE_RULE_TYPES.includes(r.ruleType)) return { error: `Unknown rule type: ${r.ruleType}.` };
    const config = r.config && typeof r.config === 'object' && !Array.isArray(r.config) ? r.config : {};
    if (JSON.stringify(config).length > MAX_JSON_BYTES) return { error: `Rule ${i + 1} is too large.` };
    rules.push({ rule_type: r.ruleType, sort_order: i, config });
  }
  return { rules };
}

function isEmptyValue(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function jsonSize(v) {
  try { return JSON.stringify(v).length; } catch (e) { return Infinity; }
}

/**
 * Checks one answer against its field. Returns { value_text?, value_json?,
 * file_path? } (normalized) or { error }. `resolveFile` turns a client upload
 * receipt into the stored path, or null if the receipt is not one this server
 * issued for this company. The browser can never name a storage path itself.
 */
export function validateAnswerValue(field, raw, { resolveFile } = {}) {
  const info = fieldTypeInfo(field.field_type);
  if (!info) return { error: `"${field.label}" has an unknown type.` };
  const config = field.config || {};

  if (info.value === 'file') {
    if (isEmptyValue(raw)) return {};
    const path = resolveFile ? resolveFile(raw, field) : null;
    if (!path) return {};
    return { file_path: path };
  }

  if (isEmptyValue(raw)) return {};

  if (fieldTypeIsIdBearing(field.field_type)) {
    return { error: `"${field.label}" can't be answered yet.` };
  }

  switch (field.field_type) {
    case 'yesno': {
      const v = String(raw).trim().toLowerCase();
      if (v !== 'yes' && v !== 'no') return { error: `"${field.label}" must be Yes or No.` };
      return { value_text: v };
    }
    case 'short_text': {
      const v = String(raw).trim();
      if (v.length > MAX_SHORT_TEXT) return { error: `"${field.label}" is too long.` };
      return { value_text: v };
    }
    case 'long_text': {
      const v = String(raw).trim();
      if (v.length > MAX_LONG_TEXT) return { error: `"${field.label}" is too long.` };
      return { value_text: v };
    }
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: `"${field.label}" must be a number.` };
      return { value_text: String(n) };
    }
    case 'date': {
      const v = String(raw).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) return { error: `"${field.label}" must be a date.` };
      return { value_text: v };
    }
    case 'dropdown': {
      const v = String(raw).trim();
      if (!(config.options || []).includes(v)) return { error: `"${field.label}" has an answer that is not one of its options.` };
      return { value_text: v };
    }
    case 'multiselect': {
      if (!Array.isArray(raw)) return { error: `"${field.label}" must be a list.` };
      const picked = [...new Set(raw.map((x) => String(x)))];
      const options = config.options || [];
      if (picked.some((p) => !options.includes(p))) return { error: `"${field.label}" has an answer that is not one of its options.` };
      return { value_json: picked };
    }
    case 'condition3': {
      const v = String(raw).trim();
      if (!CONDITION_VALUES.includes(v)) return { error: `"${field.label}" must be Good, Monitor, Defective or N/A.` };
      return { value_text: v };
    }
    default: {
      // Picker and block types: structured JSON, size-capped. Their shape is
      // checked by the code that owns them (the equipment picker, the hazard
      // table) as those land in later work packages.
      if (typeof raw !== 'object') return { error: `"${field.label}" is not valid.` };
      if (jsonSize(raw) > MAX_JSON_BYTES) return { error: `"${field.label}" is too large.` };
      return { value_json: raw };
    }
  }
}

/**
 * Validates a whole submission. `answers` is { [fieldKey]: value }. Returns
 * { rows } ready for document_answers (minus record_id), or { error }.
 * Unknown keys are rejected so a client cannot smuggle extra data in.
 * `notes` is { [fieldKey]: text } for the optional per-answer note.
 */
export function validateAnswers(fields, answers, { notes, resolveFile } = {}) {
  const input = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  const noteMap = notes && typeof notes === 'object' && !Array.isArray(notes) ? notes : {};
  const known = new Set(fields.map((f) => f.field_key));
  for (const k of Object.keys(input)) {
    if (!known.has(k)) return { error: `Unknown field: ${k}.` };
  }
  const rows = [];
  for (const field of fields) {
    const out = validateAnswerValue(field, input[field.field_key], { resolveFile });
    if (out.error) return { error: out.error };
    const present = out.value_text != null || out.value_json != null || out.file_path != null;
    if (field.required && !present) return { error: `"${field.label}" is required.` };

    let note = noteMap[field.field_key] != null ? String(noteMap[field.field_key]).trim().slice(0, 2000) : null;
    if (note === '') note = null;
    // A flagged condition needs a note, the rule Inspection.jsx enforces today.
    if (field.field_type === 'condition3' && field.config?.requireNote !== false) {
      if ((out.value_text === 'Monitor' || out.value_text === 'Defective') && !note) {
        return { error: `"${field.label}" needs a note when it is ${out.value_text}.` };
      }
    }
    if (!present && !note) continue;
    rows.push({
      field_id: field.id,
      field_key: field.field_key,
      question_text: field.label,
      field_type: field.field_type,
      value_text: out.value_text ?? null,
      value_json: out.value_json ?? null,
      file_path: out.file_path ?? null,
      notes: note,
    });
  }
  return { rows };
}
