// server-lib/portalEnabled.js
//
// Which companies actually have the FORA Field Portal. Portal is a separate,
// quoted product from the Platform, so a company that only bought Platform
// modules must not see a Portal tab in its dashboard.
//
// Portal has no module key and no column of its own. Until now its dashboard
// tab rode `companies.roster_enabled`, which every provisioned company has, so
// every Platform customer saw an empty Portal tab. The honest signal is that
// FORA has built the company at least one Portal document, so that is what
// this uses: no migration, no backfill, and a company with Portal documents
// keeps the tab even if every one of them is later switched off, because its
// Inbox and history still live there.
//
// Lives outside api/ for the reason server-lib/pricing.js does: Vercel only
// turns files directly under api/ into functions. Dashboard.jsx imports
// portalTabVisible from here too, the same way it imports portalDepartments.

// One small indexed lookup per company rather than one wide select over every
// company's documents: PostgREST caps a select at 1000 rows, and a truncated
// list would silently hide the tab from a real Portal customer. A supervisor's
// list has one company; the founder's list is short.
//
// A failed lookup answers true for that company. Showing a Platform customer
// an empty tab for a moment is cheap. Hiding a Portal customer's Inbox is not.
export async function withPortalFlag(supabaseAdmin, companies) {
  const list = Array.isArray(companies) ? companies : [];
  return Promise.all(list.map(async (c) => {
    const { data, error } = await supabaseAdmin
      .from('portal_documents')
      .select('id')
      .eq('company_id', c.id)
      .limit(1);
    if (error) {
      console.error('portal_documents lookup failed for company', c.id, error.message);
      return { ...c, portal_enabled: true };
    }
    return { ...c, portal_enabled: Array.isArray(data) && data.length > 0 };
  }));
}

// The Portal tab needs both signals. A company with Portal documents and no
// roster has nobody to route them to (department scoping needs a real roster
// row per supervisor), so `roster_enabled` stays part of the gate.
export function portalTabVisible(company) {
  return Boolean(company && company.roster_enabled && company.portal_enabled);
}
