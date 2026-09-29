// server-lib/portalDepartments.js
//
// The fixed v1 department list for Company Portal (FORA Company Portal —
// Build Spec, "Fixed department list (v1)"). Lives here, not inline in
// api/companydata.js, because phase 3 (document-level routing) and phase 4
// (assignment + compliance) both need the same list to validate a
// document's routing departments and to scope a supervisor's dashboard —
// same reasoning as server-lib/pricing.js's MODULE_KEYS being the one place
// a module key is spelled out.
//
// Deliberately NOT a DB check constraint (see
// docs/schema/roster-departments-migration.sql) and deliberately does not
// include "Company Admin": that access already comes unconditionally from
// roster.role === 'admin', so it is never a value a department column
// holds. Extending the list later (the spec's "leave room for a 7th+")
// means adding a key here, not a migration.
export const PORTAL_DEPARTMENTS = ['hr', 'payroll', 'safety', 'maintenance', 'operations_manager'];

export const PORTAL_DEPARTMENT_LABELS = {
  hr: 'HR',
  payroll: 'Payroll',
  safety: 'Safety',
  maintenance: 'Maintenance',
  operations_manager: 'Operations Manager',
};
