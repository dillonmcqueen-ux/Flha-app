// Pure helpers for the worker form (WP7): starting answers, what counts as
// filled, the problems to show before submit, and splitting the answers into
// plain values and files that must be uploaded first. No React, no network.

export const FILE_TYPES = ['file_upload', 'photo', 'signature'];
export const ARRAY_TYPES = ['multiselect', 'ppe_list', 'text_list', 'hazard_table', 'section_table'];
// Only crew signatures: they sign through the crew parameter of submit, not a field.
// The pickers (equipment, attachments, site, person, linked document) are answerable.
export const UNANSWERABLE_TYPES = ['crew_signatures'];
export const UPLOAD_KIND = { signature: 'signature', file_upload: 'attachment', photo: 'attachment' };
export const BUCKET_FOR_KIND = { pdf: 'flha-reports', signature: 'signatures', attachment: 'portal-attachments' };
export const RISKS = ['Low', 'Medium', 'High', 'Extreme'];

/** A field the worker is not shown: the AI assist or the form fills it in. */
export const isHidden = (f) => !!(f && f.config && f.config.hidden === true);

export function initialAnswers(fields) {
  const out = {};
  for (const f of fields || []) out[f.field_key] = ARRAY_TYPES.includes(f.field_type) ? [] : '';
  return out;
}

export function isFilled(field, value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    if (field.field_type === 'hazard_table') return value.some((r) => r && String(r.hazard || '').trim());
    return true;
  }
  if (typeof value === 'object') {
    // A typed-in machine with no name is not an answer.
    if ('text' in value && !String(value.text || '').trim()) return false;
    return Object.keys(value).length > 0;
  }
  return true;
}

/** What the worker still has to do before Submit. The server repeats every check. */
export function clientProblems(fields, answers, notes = {}, keptFileKeys = []) {
  const out = [];
  for (const f of fields || []) {
    if (UNANSWERABLE_TYPES.includes(f.field_type) || isHidden(f)) continue;
    if (keptFileKeys.includes(f.field_key) && !isFilled(f, answers[f.field_key])) continue; // an earlier file stays
    const v = answers[f.field_key];
    if (f.required && !isFilled(f, v)) out.push(`"${f.label}" is required.`);
    if (f.field_type === 'condition3' && f.config?.requireNote !== false && (v === 'Monitor' || v === 'Defective') && !String(notes[f.field_key] || '').trim()) {
      out.push(`"${f.label}" needs a note.`);
    }
    if (f.field_type === 'yesno' && f.config?.requireNoteOnNo === true && String(v).toLowerCase() === 'no' && !String(notes[f.field_key] || '').trim()) {
      out.push(`"${f.label}" needs a note.`);
    }
  }
  return out;
}

/**
 * Splits answers into what the server gets as plain values and the files
 * (data URLs) that are uploaded first and replaced by upload receipts.
 * Empty answers are left out. Unanswerable types are never sent.
 */
export function splitAnswers(fields, answers) {
  const values = {};
  const uploads = [];
  for (const f of fields || []) {
    if (UNANSWERABLE_TYPES.includes(f.field_type)) continue;
    const v = answers[f.field_key];
    if (!isFilled(f, v)) continue;
    if (FILE_TYPES.includes(f.field_type)) {
      if (typeof v === 'string' && v.startsWith('data:')) uploads.push({ key: f.field_key, kind: UPLOAD_KIND[f.field_type], dataUrl: v, field_type: f.field_type });
      continue;
    }
    if (f.field_type === 'hazard_table') values[f.field_key] = v.filter((r) => r && String(r.hazard || '').trim()).map(cleanHazard);
    else values[f.field_key] = v;
  }
  return { values, uploads };
}

export function cleanHazard(r) {
  return {
    task: String(r.task || '').slice(0, 300),
    hazard: String(r.hazard || '').slice(0, 300),
    control: String(r.control || '').slice(0, 1000),
    sopRef: r.sopRef ? String(r.sopRef).slice(0, 100) : null,
    risk: RISKS.includes(r.risk) ? r.risk : 'Low',
  };
}

export const emptyHazard = () => ({ task: '', hazard: '', control: '', sopRef: null, risk: 'Low' });

export function newClientSubmissionId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** A browser-safe file extension from a data URL's media type. */
export function extForDataUrl(dataUrl) {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+)/i.exec(dataUrl || '');
  const t = m ? m[1].toLowerCase() : '';
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' })[t] || 'png';
}
