// Pure helpers for showing a filed record: the label for a status, one
// readable line per answer, and turning stored answer rows back into the
// form's answers so a returned document can be fixed.

export const STATUS_LABEL = {
  draft: 'Draft', submitted: 'Filed', pending_approval: 'Waiting for review', returned: 'Sent back', approved: 'Approved', closed: 'Closed',
};
export const statusLabel = (s) => STATUS_LABEL[s] || String(s || '');

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** One readable string for an answer row (document_answers). */
export function formatAnswer(row) {
  if (!row) return '';
  if (row.file_path) return 'File attached';
  if (row.value_json != null) {
    const v = row.value_json;
    if (row.field_type === 'hazard_table' && Array.isArray(v)) {
      return v.map((r) => `${r.hazard || ''}${r.risk ? ` (${r.risk})` : ''}${r.control ? `: ${r.control}` : ''}`).join('\n');
    }
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? (x.label || '') : String(x))).filter(Boolean).join(', ');
    if (typeof v === 'object') return Array.isArray(v.labels) ? v.labels.join(', ') : String(v.label || '');
    return String(v);
  }
  if (row.value_text != null) return row.field_type === 'yesno' ? cap(row.value_text) : String(row.value_text);
  return '';
}

/**
 * Stored rows into { answers, notes } for the form. File answers are left out:
 * the server keeps an earlier file when none is sent again.
 */
export function rowsToForm(rows) {
  const answers = {}; const notes = {};
  for (const r of rows || []) {
    if (r.file_path) continue;
    if (r.value_json != null) answers[r.field_key] = r.value_json;
    else if (r.value_text != null) answers[r.field_key] = r.value_text;
    if (r.notes) notes[r.field_key] = r.notes;
  }
  return { answers, notes };
}

export const hasFiles = (rows) => (rows || []).some((r) => !!r.file_path);

/** Badge total shown on the nav: things waiting on this person. */
export const inboxCount = (inbox, escalations) => (inbox?.counts?.review || 0) + (Array.isArray(escalations) ? escalations.length : 0);
