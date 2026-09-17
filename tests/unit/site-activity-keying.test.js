// Pins what counts as ONE site in the analytics site tables.
//
// Break #2's analytics half. PR #118 added site_id to all five field forms,
// but every list payload still SELECTed only the free text, so the key was
// written on submit and thrown away before analytics ever saw it — a
// producer nothing consumes, introduced by the fix for the break it belongs
// to.
//
// analyticsUtils.js also carried a comment saying the field and scheduled
// tables were "not safe to merge — casing/typo drift and fallback labels
// would collide". That was true while a NAME was the only key. It stopped
// being true when site_id landed, and nothing noticed.
//
// What these cases exist to stop coming back:
//   * one real site splitting into several rows because workers spelled it
//     differently, or because it was renamed after the documents were filed;
//   * the two tables disagreeing about what a site is called, which is what
//     makes them impossible to read side by side;
//   * the "other / not in the list" path being forced to collide with a
//     registered site, or with another unregistered place of the same name;
//   * the tables breaking when the sites map is unavailable.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fieldSiteActivity, scheduledSiteActivity } = await import('../../src/analyticsUtils.js');

const siteNames = { 1: 'Camrose County', 2: 'Red Deer County' };
const none = [];

test('one real site spelled three ways is ONE row', () => {
  const rows = fieldSiteActivity(
    [{ job_site: 'Camrose Cty', site_id: 1 }],
    [{ site: 'camrose county', site_id: 1 }],
    [{ site: 'CAMROSE COUNTY  ', site_id: 1 }],
    none, none, siteNames,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].site, 'Camrose County');
  assert.equal(rows[0].flhas, 1);
  assert.equal(rows[0].toolbox, 1);
  assert.equal(rows[0].daily, 1);
});

test('a site renamed after the fact reads under its current name', () => {
  // The documents still carry the old text. The id is what survives a
  // rename, which is the reason to key on it.
  const rows = fieldSiteActivity([{ job_site: 'Old Yard Name', site_id: 1 }], none, none, none, none, siteNames);
  assert.equal(rows[0].site, 'Camrose County');
});

test('both tables name the same site identically', () => {
  const field = fieldSiteActivity([{ job_site: 'camrose cty', site_id: 1 }], none, none, none, none, siteNames);
  const scheduled = scheduledSiteActivity([{ site_name: 'Camrose County', site_id: 1 }], none, none, siteNames);
  assert.equal(field[0].site, scheduled[0].site);
  assert.equal(field[0].siteId, scheduled[0].siteId);
});

test('an unregistered place keeps its own row and never merges into a real site', () => {
  const rows = fieldSiteActivity(
    [{ job_site: 'Camrose County', site_id: 1 }],
    [{ site: 'Camrose County', site_id: null }],
    none, none, none, siteNames,
  );
  // Same words, but one is the registered site and the other is whatever a
  // worker typed on the "other" path. Merging them would assert a link
  // nobody made.
  assert.equal(rows.length, 2);
});

test('two id-less rows with the same text still group, as they always did', () => {
  const rows = fieldSiteActivity(
    [{ job_site: 'Back Forty' }],
    [{ site: 'back forty  ' }],
    none, none, none, {},
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].flhas, 1);
  assert.equal(rows[0].toolbox, 1);
  assert.equal(rows[0].siteId, null);
});

test('grouping still works with no sites map — only the label falls back', () => {
  // The merge uses the id, not the name, so an unavailable map costs the
  // canonical label and nothing else.
  const rows = fieldSiteActivity(
    [{ job_site: 'Camrose Cty', site_id: 1 }],
    [{ site: 'Camrose Cty', site_id: 1 }],
    [{ site: 'Camrose Cty', site_id: 1 }],
    none, none, {},
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].site, 'Camrose Cty');
});

test('an id-keyed bucket whose site was deleted still has a name', () => {
  const rows = fieldSiteActivity([{ job_site: 'Camrose Cty', site_id: 99 }], none, none, none, none, siteNames);
  assert.equal(rows[0].site, 'Camrose Cty');
});

test('a row with neither id nor text is dropped, not bucketed as blank', () => {
  const rows = fieldSiteActivity([{ job_site: '  ' }, { job_site: null }], none, none, none, none, siteNames);
  assert.deepEqual(rows, []);
});

test('site id 0 is treated as a real id, not as missing', () => {
  // Postgres will not hand out 0 today, but "" and null are the empty cases
  // and a falsy-check here would silently reroute a real row to name keying.
  const rows = fieldSiteActivity([{ job_site: 'Zero Yard', site_id: 0 }], none, none, none, none, { 0: 'Zero Yard' });
  assert.equal(rows[0].siteId, 0);
  assert.equal(rows[0].site, 'Zero Yard');
});

test('scheduled counts still only include unresolved corrective actions', () => {
  const rows = scheduledSiteActivity(
    none,
    [{ site_name: 'Camrose County', site_id: 1, status: 'resolved' }, { site_name: 'Camrose County', site_id: 1, status: 'open' }],
    none, siteNames,
  );
  assert.equal(rows[0].openActions, 1);
});

test('one site\'s documents never leak into another site\'s row', () => {
  const rows = fieldSiteActivity(
    [{ job_site: 'Camrose Cty', site_id: 1 }],
    [{ site: 'Red Deer', site_id: 2 }],
    none, none, none, siteNames,
  );
  const byName = Object.fromEntries(rows.map(r => [r.site, r]));
  assert.equal(byName['Camrose County'].flhas, 1);
  assert.equal(byName['Camrose County'].toolbox, 0);
  assert.equal(byName['Red Deer County'].toolbox, 1);
});

test('a typed site name cannot collide with a real site\'s bucket', () => {
  // The bucket keys are namespaced ("id:1" vs "name:...") rather than raw,
  // so free text can never land in a registered site's bucket by spelling
  // itself like one. Without the prefix a worker typing "id:1" on the
  // "other" path would have their FLHA counted against whichever site
  // happens to hold that id.
  const rows = fieldSiteActivity(
    [{ job_site: 'Camrose County', site_id: 1 }],
    [{ site: 'id:1', site_id: null }],
    none, none, none, siteNames,
  );
  assert.equal(rows.length, 2);
  const real = rows.find(r => r.siteId === 1);
  assert.equal(real.flhas, 1);
  assert.equal(real.toolbox, 0, 'the typed "id:1" row must not be counted against the real site');
});

test('a site with open corrective actions is ONE row, not two', () => {
  // A regression this change introduced and tenant-scope-reviewer caught.
  // monthlyRecords and customDocs carry site_id, but the enriched
  // corrective-action rows did not, so they bucketed by name while
  // everything else bucketed by id. The site split into two rows -- one
  // with the monthly counts and openActions: 0, one with only the open
  // actions -- and since the table sorts by openActions desc, the fragment
  // sorted to the top where a supervisor reads it first.
  const rows = scheduledSiteActivity(
    [{ site_name: 'Camrose County', site_id: 1 }],
    [{ site_name: 'Camrose County', site_id: 1, status: 'open' }],
    [],
    siteNames,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].monthly, 1);
  assert.equal(rows[0].openActions, 1);
});

test('an action whose "site" is really a machine never merges into a site', () => {
  // Corrective actions from equipment inspections fill the site slot with
  // an equipment_label. api/monthly.js gives those rows a null site_id on
  // purpose so they cannot adopt a real site's bucket.
  const rows = scheduledSiteActivity(
    [{ site_name: 'Camrose County', site_id: 1 }],
    [{ site_name: 'Excavator 2', site_id: null, status: 'open' }],
    [],
    siteNames,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.siteId === 1).openActions, 0);
});
