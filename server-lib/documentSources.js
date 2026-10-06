// server-lib/documentSources.js
// Where each kind of submitted document lives and which columns a read-only
// list needs. One list, shared by the crew lead's list (api/customforms.js)
// and the auditor's list (api/audit.js), so the two cannot drift apart on
// which tables or columns they read.
//
// Monthly inspections and custom documents carry no company_id of their own
// and are reached through their forms, which are company-scoped; they are
// handled by the callers.

export const DIRECT_SOURCES = [
  { type: 'flha', key: 'flha', table: 'flhas', title: 'FLHA', cols: 'id, job_site, site_id, created_at, pdf_url, status, submitted_by_roster_id', sub: (r) => r.job_site },
  { type: 'toolbox', key: 'toolbox', table: 'toolbox_talks', title: 'Toolbox Talk', cols: 'id, topic, site_id, created_at, pdf_url, submitted_by_roster_id', sub: (r) => r.topic },
  { type: 'daily', key: 'daily', table: 'daily_reports', title: 'Daily Report', cols: 'id, site, site_id, created_at, pdf_url, submitted_by_roster_id', enteredBy: true, sub: (r) => r.site },
  { type: 'incident', key: 'incident', table: 'incidents', title: 'Incident Report', cols: 'id, site, site_id, created_at, pdf_url, submitted_by_roster_id', sub: (r) => r.site },
  { type: 'nearmiss', key: 'nearmiss', table: 'near_misses', title: 'Near Miss Report', cols: 'id, site, site_id, created_at, pdf_url, submitted_by_roster_id', sub: (r) => r.site },
  { type: 'fuellog', key: 'fuellog', table: 'fuel_logs', title: 'Fuel Log', cols: 'id, equipment_label, site_id, created_at, pdf_url, submitted_by_roster_id', enteredBy: true, sub: (r) => r.equipment_label },
];

// Equipment inspections carry no site, only a machine, so a list that places
// documents by site cannot place them. A crew lead's list places them by
// author instead; an auditor's, which is by site, cannot.
export const INSPECTION_SOURCE = { type: 'inspection', key: 'inspection', table: 'inspections', title: 'Equipment Inspection', cols: 'id, equipment_label, created_at, pdf_url, submitted_by_roster_id', sub: (r) => r.equipment_label };

// Built-in document keys an auditor can be given: everything placed by site.
export const AUDITABLE_BUILTIN_KEYS = [...DIRECT_SOURCES.map((s) => s.key), 'monthly'];
