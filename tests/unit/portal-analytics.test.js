// Tests for the Portal half of map break #40: fieldSiteActivity's `extras`
// argument and portalSummary in src/analyticsUtils.js.
//
// Run with `npm run test:unit`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldSiteActivity, portalSummary } from '../../src/analyticsUtils.js';

const NOW = new Date();
const iso = (daysAgo) => new Date(NOW.getTime() - daysAgo * 86400000).toISOString();

test('fieldSiteActivity without extras is unchanged and reports zero portal/custom', () => {
  const rows = fieldSiteActivity([{ site_id: 1, job_site: 'Yard' }], [], [], [], [], { 1: 'Yard' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].flhas, 1);
  assert.equal(rows[0].portal, 0);
  assert.equal(rows[0].custom, 0);
});

test('portal records and custom docs join the same site bucket by site id', () => {
  const rows = fieldSiteActivity(
    [{ site_id: 1, job_site: 'yard' }], [], [], [], [],
    { 1: 'North Yard' },
    { portal: [{ site_id: 1, site_name: 'North Yard' }, { site_id: 1, site_name: 'North Yard' }], custom: [{ site_id: 1, site_name: 'North Yard' }] },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].site, 'North Yard');
  assert.equal(rows[0].flhas, 1);
  assert.equal(rows[0].portal, 2);
  assert.equal(rows[0].custom, 1);
});

test('a site with only portal activity still gets a row', () => {
  const rows = fieldSiteActivity([], [], [], [], [], { 9: 'Shop' }, { portal: [{ site_id: 9 }] });
  assert.equal(rows[0].site, 'Shop');
  assert.equal(rows[0].portal, 1);
});

test('portalSummary counts submissions, flagged share, and open escalations', () => {
  const records = [
    { id: 1, site_id: 1, site_name: 'A', document_title: 'Pre-trip', created_at: iso(2) },
    { id: 2, site_id: 1, site_name: 'A', document_title: 'Pre-trip', created_at: iso(40) },
    { id: 3, site_id: 2, site_name: 'B', document_title: 'Hire form', created_at: iso(1) },
  ];
  const escalations = [
    { id: 10, record_id: 1, status: 'open', target_department: 'maintenance', created_at: iso(2), site_name: 'A' },
    { id: 11, record_id: 1, status: 'actioned', target_department: 'safety', created_at: iso(2), site_name: 'A' },
  ];
  const s = portalSummary(records, escalations, [], { 1: 'A', 2: 'B' });
  assert.equal(s.total, 3);
  assert.equal(s.last30, 2);
  assert.equal(s.openEscalations, 1);
  assert.equal(s.flaggedPct, 33);
  assert.equal(s.byDocument[0].label, 'Pre-trip');
  assert.equal(s.byDocument[0].count, 2);
  const a = s.bySite.find(x => x.site === 'A');
  assert.equal(a.submissions, 2);
  assert.equal(a.openEscalations, 1);
  assert.deepEqual(s.escalationsByDepartment.map(d => d.label).sort(), ['Maintenance', 'Safety']);
  assert.equal(s.trend.length, 6);
});

test('portalSummary completion rate comes from assignment rows and handles none assigned', () => {
  const rows = [{ status: 'submitted' }, { status: 'overdue' }, { status: 'not_started' }, { status: 'submitted' }];
  const s = portalSummary([], [], rows);
  assert.equal(s.assigned, 4);
  assert.equal(s.completionPct, 50);
  assert.equal(s.overdue, 1);
  const empty = portalSummary();
  assert.equal(empty.assigned, 0);
  assert.equal(empty.completionPct, 0);
  assert.equal(empty.total, 0);
});

test('an escalation whose record is out of scope falls back to its own site name', () => {
  const s = portalSummary([], [{ id: 1, record_id: 99, status: 'open', site_name: 'Remote', created_at: iso(1), target_department: 'hr' }]);
  assert.equal(s.bySite[0].site, 'Remote');
  assert.equal(s.bySite[0].openEscalations, 1);
});
