// server-lib/siteScope.js
// One place to validate a client-supplied site_id, shared by every submit
// handler that now accepts one.
//
// Break #2 in docs/feature-interaction-map.md: five worker forms already
// showed a dropdown of the company's real sites, then stored the resolved
// NAME as text and threw the id away — so nothing could join an FLHA to a
// monthly inspection at the same place. They now send the id too.
//
// An id arriving from a client is a tenancy question, not a validation
// detail: without this check a worker could file their own company's FLHA
// against another company's site row, which is the same shape of mistake
// api/fuellogs.js already guards against for fuel logs. Rather than copy
// that guard into four more handlers and let them drift, it lives here.

/**
 * Returns the site id when it belongs to `companyId`, null when the caller
 * sent nothing, or `false` when it belongs to somebody else or does not
 * exist. A caller treats `false` as a 403 and null as "no site given",
 * which is legitimate — the "other / not in the list" path on every one of
 * these forms stores only the text.
 */
export async function resolveSiteId(supabaseAdmin, companyId, rawSiteId) {
  if (rawSiteId === undefined || rawSiteId === null || rawSiteId === '') return null;
  const { data: rows } = await supabaseAdmin
    .from('sites')
    .select('company_id')
    .eq('id', rawSiteId)
    .limit(1);
  if (!rows || rows.length === 0) return false;
  if (rows[0].company_id !== companyId) return false;
  return rawSiteId;
}
