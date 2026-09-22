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
 * Returns the site's own id when it belongs to `companyId`, `null` when
 * there is nothing to link, or `false` when the site belongs to another
 * company. A caller treats `false` as a 403 and `null` as "no site", which
 * is legitimate — the "other / not in the list" path stores only the text.
 *
 * A site id that does not exist returns `null`, NOT `false`, and that
 * distinction is load-bearing rather than cosmetic.
 *
 * Returning 403 for a missing site permanently wedged the offline queue.
 * src/offlineQueue.js's drainQueue marked an attempt and `break`ed on any
 * throw, with no drop path, so a submission that could never succeed was
 * retried forever AND blocked every later submission of that form type
 * behind it. The scenario is not hypothetical: a worker fills an FLHA
 * offline at a site, an admin removes that site, and the worker's queue
 * silently stops draining. Removing a used site only became possible at all
 * in the same change that added these ids, so this was a bug introduced
 * alongside the feature.
 *
 * drainQueue now DROPS a 4xx rather than wedging on it (break #21's
 * prerequisite), which changes the cost of getting this wrong rather than
 * removing it: the same 403 would now silently delete that worker's FLHA
 * instead of stalling their queue. Still `null`.
 *
 * A guessed or stale id therefore stores a text-only record — exactly what
 * the "other" path already does — while a genuine cross-tenant attempt
 * still 403s, keeping that tripwire for a real client bug or a probe.
 *
 * The cost is a narrow enumeration signal: a caller can tell whether some
 * site id exists by whether they get 403 or success. It reveals no name, no
 * owner and nothing about the site, and it is a fair trade against a
 * failure mode that silently loses a worker's queued paperwork.
 */
export async function resolveSiteId(supabaseAdmin, companyId, rawSiteId) {
  if (rawSiteId === undefined || rawSiteId === null || rawSiteId === '') return null;
  const { data: rows, error } = await supabaseAdmin
    .from('sites')
    .select('id, company_id')
    .eq('id', rawSiteId)
    .limit(1);
  // A database error must not be read as "wrong company". Fail toward the
  // text-only record rather than 403ing a worker over an outage — and, per
  // the note above, rather than wedging their queue over one.
  if (error) return null;
  if (!rows || rows.length === 0) return null;
  if (rows[0].company_id !== companyId) return false;
  // The row's own id, not the caller's value, so no coercion surprise can
  // survive the round trip.
  return rows[0].id;
}
