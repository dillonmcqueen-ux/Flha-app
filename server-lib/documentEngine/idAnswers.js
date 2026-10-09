// server-lib/documentEngine/idAnswers.js
// Answers that carry ids: equipment, attachments, a site, a person, another
// document. These were refused outright until now (validate.js) because
// storing an unchecked id would let a later reader (a PDF, the maintenance
// join, the Brain) follow an id into another company's data.
//
// Every id is looked up here against the CALLER'S company, and the label that
// is stored comes from the database row, never from the request. The client
// may send either the short form ({ equipmentId: 4 }) or the stored form
// ({ equipment_id: 4, label: 'x' }, which is what a returned document hands
// back for fixing); only the id is read from either.
//
// Returns { resolved: Map(fieldKey -> value_json) } or { error }.

export const RESOLVABLE_ID_TYPES = ['equipment_picker', 'attachment_picker', 'site_picker', 'person_picker', 'linked_document'];

const MAX_ATTACHMENTS = 10;
const MAX_TEXT = 100;

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
const posInt = (v) => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const pick = (obj, ...keys) => { for (const k of keys) if (obj && obj[k] != null) return obj[k]; return undefined; };

export function equipmentLabel(e) {
  const unit = e.unit_number ? `Unit ${e.unit_number}` : '';
  const what = [e.year, e.make, e.model].filter(Boolean).join(' ');
  return [unit, what || e.type].filter(Boolean).join(' - ') || `Equipment ${e.id}`;
}

async function readRows(query, what) {
  const { data, error } = await query;
  if (error) throw Object.assign(new Error(`Couldn't check ${what}. Please try again.`), { status: 503 });
  return data || [];
}

/**
 * fields: the version's field rows. answers: what the client sent.
 * deps.resolveSiteId(raw) vets a site id the way a record's own site is
 * vetted (false means not allowed). `session` decides who may link a record.
 */
export async function resolveIdAnswers(db, { companyId, session, fields, answers, deps }) {
  const resolved = new Map();
  const input = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  try {
    for (const f of fields || []) {
      if (!RESOLVABLE_ID_TYPES.includes(f.field_type)) continue;
      const raw = input[f.field_key];
      if (isEmpty(raw)) continue;
      const bad = (msg) => ({ error: `"${f.label}" ${msg}` });

      if (f.field_type === 'equipment_picker') {
        if (typeof raw !== 'object' || Array.isArray(raw)) return bad('is not valid.');
        const id = posInt(pick(raw, 'equipmentId', 'equipment_id'));
        if (id == null) {
          // A machine that is not in the fleet (a rental): free text, no id.
          const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, MAX_TEXT) : '';
          if (!text) return bad('needs a machine.');
          resolved.set(f.field_key, { equipment_id: null, label: text });
          continue;
        }
        const rows = await readRows(db.from('equipment').select('id, year, make, model, type, unit_number').eq('company_id', companyId).eq('id', id).is('retired_at', null), 'the equipment');
        if (rows.length === 0) return bad('is not one of your machines.');
        resolved.set(f.field_key, { equipment_id: rows[0].id, label: equipmentLabel(rows[0]) });
      } else if (f.field_type === 'attachment_picker') {
        const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? pick(raw, 'equipmentIds', 'equipment_ids') : null);
        if (!Array.isArray(list)) return bad('is not valid.');
        const ids = [...new Set(list.map(posInt))];
        if (ids.length === 0 || ids.includes(null)) return bad('is not valid.');
        if (ids.length > MAX_ATTACHMENTS) return bad(`can have at most ${MAX_ATTACHMENTS} attachments.`);
        const rows = await readRows(db.from('equipment').select('id, year, make, model, type, unit_number, is_attachment').eq('company_id', companyId).in('id', ids).is('retired_at', null), 'the attachments');
        const byId = new Map(rows.map((r) => [Number(r.id), r]));
        if (ids.some((i) => !byId.has(i) || byId.get(i).is_attachment !== true)) return bad('has something that is not one of your attachments.');
        resolved.set(f.field_key, { equipment_ids: ids, labels: ids.map((i) => equipmentLabel(byId.get(i))) });
      } else if (f.field_type === 'site_picker') {
        const id = posInt(raw && typeof raw === 'object' ? pick(raw, 'siteId', 'site_id') : raw);
        if (id == null) return bad('needs a site.');
        const ok = deps && deps.resolveSiteId ? await deps.resolveSiteId(id) : null;
        if (ok === false || ok == null) return bad('is not a site you can use.');
        const rows = await readRows(db.from('sites').select('id, name').eq('company_id', companyId).eq('id', Number(ok)), 'the site');
        if (rows.length === 0) return bad('is not one of your sites.');
        resolved.set(f.field_key, { site_id: rows[0].id, label: rows[0].name });
      } else if (f.field_type === 'person_picker') {
        const id = posInt(raw && typeof raw === 'object' ? pick(raw, 'rosterId', 'roster_id') : raw);
        if (id == null) return bad('needs a person.');
        const rows = await readRows(db.from('roster').select('id, name, active, role').eq('company_id', companyId).eq('id', id), 'the person');
        const r = rows[0];
        if (!r || r.active === false || r.role === 'auditor') return bad('is not someone on your roster.');
        resolved.set(f.field_key, { roster_id: r.id, label: r.name });
      } else if (f.field_type === 'linked_document') {
        const id = posInt(raw && typeof raw === 'object' ? pick(raw, 'recordId', 'record_id') : raw);
        if (id == null) return bad('needs a document.');
        const rows = await readRows(db.from('document_records').select('id, definition_id, submitted_by_roster_id, submitted_at').eq('company_id', companyId).eq('id', id), 'the document');
        const rec = rows[0];
        const mine = session && session.userId != null && Number(rec && rec.submitted_by_roster_id) === Number(session.userId);
        const tier = !!session && (session.role === 'admin' || session.role === 'supervisor');
        if (!rec || !(mine || tier)) return bad('is not a document you can link.');
        const defs = await readRows(db.from('document_definitions').select('id, title').eq('id', rec.definition_id), 'the document');
        resolved.set(f.field_key, { record_id: rec.id, definition_id: rec.definition_id, label: `${(defs[0] && defs[0].title) || 'Document'} #${rec.id}` });
      }
    }
  } catch (e) {
    if (e && e.status) return { error: e.message, status: e.status };
    throw e;
  }
  return { resolved };
}

export const PICKER_KINDS = ['equipment', 'attachment', 'site', 'person', 'document'];
const MAX_OPTIONS = 500;

/**
 * What a worker may choose from in a picker, scoped to the caller's company.
 * Returns [{ id, label }]. Choosing is checked again on submit (resolveIdAnswers);
 * this only fills the list.
 */
export async function listPickerOptions(db, { companyId, session, kind }) {
  if (!PICKER_KINDS.includes(kind)) return { error: 'Unknown picker.', status: 400 };
  try {
    if (kind === 'equipment' || kind === 'attachment') {
      const rows = await readRows(db.from('equipment').select('id, year, make, model, type, unit_number, is_attachment').eq('company_id', companyId).is('retired_at', null).order('id').limit(MAX_OPTIONS), 'the equipment');
      return { options: rows.filter((r) => (r.is_attachment === true) === (kind === 'attachment')).map((r) => ({ id: r.id, label: equipmentLabel(r) })) };
    }
    if (kind === 'site') {
      const rows = await readRows(db.from('sites').select('id, name').eq('company_id', companyId).order('name').limit(MAX_OPTIONS), 'the sites');
      return { options: rows.map((r) => ({ id: r.id, label: r.name })) };
    }
    if (kind === 'person') {
      const rows = await readRows(db.from('roster').select('id, name, active, role').eq('company_id', companyId).eq('active', true).order('name').limit(MAX_OPTIONS), 'the roster');
      return { options: rows.filter((r) => r.role !== 'auditor').map((r) => ({ id: r.id, label: r.name })) };
    }
    const tier = !!session && (session.role === 'admin' || session.role === 'supervisor');
    let q = db.from('document_records').select('id, definition_id, submitted_at, created_at').eq('company_id', companyId);
    if (!tier) {
      if (session && session.userId != null) q = q.eq('submitted_by_roster_id', session.userId); else return { options: [] };
    }
    const recs = await readRows(q.order('created_at', { ascending: false }).limit(50), 'the documents');
    const defIds = [...new Set(recs.map((r) => r.definition_id))];
    const defs = defIds.length ? await readRows(db.from('document_definitions').select('id, title').in('id', defIds), 'the documents') : [];
    const title = new Map(defs.map((d) => [Number(d.id), d.title]));
    return { options: recs.map((r) => ({ id: r.id, label: `${title.get(Number(r.definition_id)) || 'Document'} #${r.id}` })) };
  } catch (e) {
    if (e && e.status) return { error: e.message, status: e.status };
    throw e;
  }
}
