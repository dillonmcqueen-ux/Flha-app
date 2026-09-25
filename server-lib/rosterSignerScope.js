// server-lib/rosterSignerScope.js
//
// Strips a client-claimed `rosterId` off a second-signer entry — a Toolbox
// Talk attendee (toolbox_talks.attendees_json) or FLHA "additional crew"
// member (flhas.crew_signatures) — whenever it doesn't actually belong to
// the submitting company's own active roster.
//
// docs/feature-interaction-map.md break #31: unlike site_id/equipment_id
// (server-lib/siteScope.js, server-lib/equipmentScope.js), which travel the
// same "text stays authoritative, an id rides along" shape and ARE checked
// against the caller's company on submit, this rosterId lived inside a
// jsonb blob on the client-submittable field allowlist with nothing
// re-reading it server-side. A worker could hand-craft attendees_json with
// another company's roster id (or an id that never existed) and it would be
// stored — and rendered — as if it had been picked from the real dropdown,
// which is exactly the forgeable state this whole feature exists to close.
//
// Deliberately more forgiving than resolveSiteId/resolveEquipmentIds: a bad
// id here never rejects the submission. The name and signature the worker
// actually captured on the canvas are still a real record of who signed;
// losing an entire toolbox talk or FLHA over one unverifiable id would be a
// worse failure than just not trusting that one id. So an id that doesn't
// resolve, or resolves to another company's roster row, is simply nulled —
// the entry falls back to being an unverified name, the same as it was
// before this feature existed.
export async function sanitizeSignerRosterIds(supabaseAdmin, companyId, signers) {
  if (!Array.isArray(signers) || signers.length === 0) return signers;

  const claimedIds = [...new Set(
    signers
      .map(s => s && s.rosterId)
      .filter(id => id !== undefined && id !== null)
      .map(String)
  )];
  if (claimedIds.length === 0) return signers;

  const { data: rows, error } = await supabaseAdmin
    .from('roster')
    .select('id, company_id')
    .in('id', claimedIds);
  // Fail toward stripping every claimed id rather than trusting one we
  // couldn't verify because of an outage.
  const owned = new Set(
    (error || !rows ? [] : rows)
      .filter(r => r.company_id === companyId)
      .map(r => String(r.id))
  );

  return signers.map(s => {
    if (!s || typeof s !== 'object' || s.rosterId === undefined || s.rosterId === null) return s;
    return owned.has(String(s.rosterId)) ? s : { ...s, rosterId: null };
  });
}
