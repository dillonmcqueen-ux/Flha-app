// server-lib/documentEngine/companyDocs.js
// Which unified-engine documents a company has switched on and published.
// Shared by the assignment screen (server-lib/assignmentAdmin.js) and the
// auditor scope (server-lib/auditorAccess.js, api/audit.js), which both offer
// "engine_<definitionId>" document keys and must agree on what counts.
// A missing table (migration not applied) or a read error means none.

export const engineDocKey = (definitionId) => `engine_${definitionId}`;
export const ENGINE_KEY_RE = /^engine_(\d+)$/;

/** [{ id, title }] sorted by title: enabled for the company, published, not archived, the company's own or a FORA template. */
export async function listEngineDocuments(supabase, companyId) {
  try {
    const { data: settings, error } = await supabase.from('company_documents').select('definition_id').eq('company_id', companyId).eq('is_enabled', true);
    if (error || !settings || settings.length === 0) return [];
    const { data: defs, error: defErr } = await supabase.from('document_definitions').select('id, title, company_id, current_version_id, archived_at').in('id', settings.map((x) => x.definition_id));
    if (defErr || !defs) return [];
    return defs
      .filter((d) => d.current_version_id && !d.archived_at && (d.company_id == null || Number(d.company_id) === Number(companyId)))
      .map((d) => ({ id: d.id, title: d.title }))
      .sort((a, b) => String(a.title).localeCompare(String(b.title)));
  } catch (e) {
    return [];
  }
}
