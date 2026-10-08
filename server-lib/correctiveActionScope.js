// server-lib/correctiveActionScope.js
// A corrective action is raised from a record (a failed monthly question, an
// incident, a near miss, a failed equipment inspection). The action carries
// finding text the record's author wrote, so it must be seen only by people who
// could open that record (break #48): the document's view rows, then the site
// and author rule. This is the one place that says which document an action
// belongs to and how to find the record it came from.

import { requireRecordsAccess } from './documentAccess.js';

/** The document key whose view rows and scope an action follows. */
export const DOC_KEY_BY_SOURCE = {
  monthly_answer: 'monthly',
  incident: 'incident',
  near_miss: 'nearmiss',
  equipment_inspection: 'inspection',
};

export const docKeyForSource = (sourceType) => DOC_KEY_BY_SOURCE[sourceType] || 'unknown';

/**
 * Where one action's source record sits: { site_id, source_author_id } (either may be
 * null), or null when the action has no resolvable source (an unknown type, or the
 * record was deleted). Every lookup is constrained to the action's own company.
 * Returns { error: true } when a read fails.
 */
export async function resolveActionSource(supabase, action) {
  const company = action.company_id;
  const id = action.source_id;
  if (id == null || company == null) return null;
  const one = async (table, columns, extra) => {
    let q = supabase.from(table).select(columns).eq('id', id);
    if (extra) q = extra(q);
    const { data, error } = await q.limit(1);
    if (error) return { error: true };
    return { row: data && data[0] ? data[0] : null };
  };
  if (action.source_type === 'incident' || action.source_type === 'near_miss') {
    const table = action.source_type === 'incident' ? 'incidents' : 'near_misses';
    const r = await one(table, 'site_id, submitted_by_roster_id', (q) => q.eq('company_id', company));
    if (r.error) return r;
    return r.row ? { site_id: r.row.site_id ?? null, source_author_id: r.row.submitted_by_roster_id ?? null } : null;
  }
  if (action.source_type === 'equipment_inspection') {
    const r = await one('inspections', 'submitted_by_roster_id', (q) => q.eq('company_id', company));
    if (r.error) return r;
    return r.row ? { site_id: null, source_author_id: r.row.submitted_by_roster_id ?? null } : null;
  }
  if (action.source_type === 'monthly_answer') {
    const a = await one('inspection_answers', 'record_id');
    if (a.error) return a;
    if (!a.row) return null;
    const { data: recs, error } = await supabase
      .from('inspection_records').select('site_id, submitted_by_roster_id, form_id').eq('id', a.row.record_id).limit(1);
    if (error) return { error: true };
    const rec = recs && recs[0];
    if (!rec) return null;
    const { data: forms, error: fErr } = await supabase
      .from('inspection_forms').select('id').eq('id', rec.form_id).eq('company_id', company).limit(1);
    if (fErr) return { error: true };
    if (!forms || forms.length === 0) return null;
    return { site_id: rec.site_id ?? null, source_author_id: rec.submitted_by_roster_id ?? null };
  }
  return null;
}

/**
 * For the write path: may this session act on this action? Returns null when
 * allowed or { status, error }. An action whose source cannot be found is placed
 * by neither site nor author, so only the Owner and founder may touch it.
 */
export async function requireActionAccess(supabase, session, action) {
  const src = await resolveActionSource(supabase, action);
  if (src && src.error) return { status: 503, error: "Couldn't check your access. Please try again." };
  const placed = { site_id: src ? src.site_id : null, source_author_id: src ? src.source_author_id : null };
  const denied = await requireRecordsAccess(supabase, session, docKeyForSource(action.source_type), [placed], { authorKey: 'source_author_id' });
  if (!denied) return null;
  return denied.status === 403 ? { status: 403, error: 'Not allowed.' } : denied;
}
