// Glue between the builder screens and api/documents.js. The pure helpers
// (row mapping, sample data) are unit tested; the fetch wrapper is thin.

/** Database field rows back into the shape saveDraft accepts. */
export function fieldsForSave(rows) {
  return (rows || []).map((r) => ({
    fieldKey: r.field_key, section: r.section || undefined, label: r.label, fieldType: r.field_type,
    config: r.config || {}, required: r.required === true, helpText: r.help_text || undefined, attachmentRules: r.attachment_rules || undefined,
  }));
}

export function rulesForSave(rows) {
  return (rows || []).map((r) => ({ ruleType: r.rule_type, config: r.config || {} }));
}

const PEOPLE = ['Jamie Worker', 'Pat Lead', 'Sam Supervisor'];

/** Made-up answers so the PDF preview shows every box filled. Never saved. */
export function sampleAnswers(fields) {
  const out = {};
  for (const f of fields || []) {
    const k = f.field_key;
    switch (f.field_type) {
      case 'yesno': out[k] = 'Yes'; break;
      case 'number': out[k] = 12; break;
      case 'date': out[k] = '2026-10-09'; break;
      case 'long_text': out[k] = 'Sample text that runs across a few lines so the box can be checked for fit. '.repeat(3).trim(); break;
      case 'dropdown': out[k] = (f.config?.options || ['Option'])[0]; break;
      case 'multiselect': case 'ppe_list': out[k] = (f.config?.options || ['Option A', 'Option B']).slice(0, 3); break;
      case 'hazard_table': out[k] = [
        { task: 'Sample task', hazard: 'Sample hazard', control: 'Sample control measure', sopRef: null, risk: 'High' },
        { task: 'Sample task', hazard: 'Second hazard', control: 'Another control', sopRef: null, risk: 'Low' },
      ]; break;
      case 'section_table': out[k] = [{ item: 'Row 1', detail: 'Detail 1' }, { item: 'Row 2', detail: 'Detail 2' }]; break;
      default: out[k] = `Sample ${f.label || k}`;
    }
  }
  return out;
}

export const sampleRecord = () => ({
  site: 'Sample Site', author: PEOPLE[0], dateText: new Date().toLocaleDateString('en-CA'),
  dateTimeText: new Date().toLocaleString('en-CA'), status: 'submitted', awaitingSignature: false,
});

export async function callDocuments(token, action, body = {}) {
  const res = await fetch('/api/documents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, token, ...body }),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
