// server-lib/onboardingRoster.js
// Turns an onboarding request's people into the roster a new company starts
// with: title, departments, division and default site per person, and the
// onboarding contact seeded as the company's Account Owner.
//
// Pure on purpose (no database, no encryption) so the rules are unit tested:
// api/login.js collects the fields, server-lib/onboardingApproval.js applies
// this plan when the company is created.

// Returns [{ name, role, email, title, departments, division, site, isOwner }].
//
// Owner = the onboarding contact. They are matched to a listed person by
// email first, then by name. If they were not listed at all they are added,
// because every company must have at least one Owner and the contact is the
// person who paid and is accountable for the account. An Owner is always a
// supervisor, so a contact listed as a worker is promoted.
export function planRoster(parsedRoster, detailsByName, contact = {}) {
  const contactEmail = String(contact.email || '').trim().toLowerCase();
  const contactName = String(contact.name || '').replace(/\s+/g, ' ').trim();

  const plan = (parsedRoster || []).map(({ name, role }) => {
    const d = (detailsByName && detailsByName.get(String(name).toLowerCase())) || {};
    return {
      name, role,
      email: d.email || null,
      title: d.title || null,
      departments: Array.isArray(d.departments) ? d.departments : [],
      division: d.division || null,
      site: d.site || null,
      isOwner: false,
    };
  });

  let ownerIdx = -1;
  if (contactEmail) ownerIdx = plan.findIndex((p) => p.email && String(p.email).trim().toLowerCase() === contactEmail);
  if (ownerIdx === -1 && contactName) ownerIdx = plan.findIndex((p) => p.name.toLowerCase() === contactName.toLowerCase());

  if (ownerIdx === -1) {
    if (!contactEmail) return plan; // nothing trustworthy to seed an Owner from
    const taken = new Set(plan.map((p) => p.name.toLowerCase()));
    let name = contactName || 'Account Owner';
    if (taken.has(name.toLowerCase())) name = `${name} (owner)`;
    plan.push({ name, role: 'supervisor', email: contact.email, title: 'Owner', departments: [], division: null, site: null, isOwner: true });
    return plan;
  }

  const owner = plan[ownerIdx];
  owner.isOwner = true;
  owner.role = 'supervisor';
  if (!owner.email && contact.email) owner.email = contact.email;
  return plan;
}
