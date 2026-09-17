// src/siteLookup.js
// Resolving the site a worker picked back to its real id.
//
// Break #2 in docs/feature-interaction-map.md. Every worker form that asks
// for a site already renders a dropdown of the company's real sites, but the
// <option value> is the site NAME, so component state holds a string and the
// id is discarded at submit. Nothing could then join an FLHA to a monthly
// inspection at the same place.
//
// This resolves the id from the list the form already loaded, rather than
// restructuring five forms to hold an id in state — which would mean
// migrating every saved draft and every queued offline payload for no
// behavioural gain. The name stays the source of truth on screen; the id
// rides along beside it.
//
// It must be called where `sites` is in scope, i.e. inside the component at
// submit time, so the id lands in the payload BEFORE it is queued. The
// resubmit* functions run from drainQueue with no component mounted and only
// get the payload, so an id resolved any later would never reach a
// submission that was filed offline.

/**
 * Returns the matching site's id, or null when the worker typed a site that
 * is not in the list ("other"), when nothing is selected, or when the list
 * has not loaded. Null is a legitimate, expected outcome — the record still
 * carries its text name.
 *
 * Matching is exact after trim/lowercase, mirroring the backfill in
 * docs/schema/site-id-on-field-forms-migration.sql. No fuzzy matching: a
 * wrong link is worse than no link, because nobody can see that it happened.
 */
export function siteIdForName(sites, name, siteMode) {
  if (siteMode === "other") return null;
  if (!Array.isArray(sites) || sites.length === 0) return null;
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return null;
  const hit = sites.find((s) => String(s.name || "").trim().toLowerCase() === wanted);
  return hit ? hit.id : null;
}
