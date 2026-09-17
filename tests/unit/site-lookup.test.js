// Pins the resolution of a picked site back to its real id.
//
// Break #2 in docs/feature-interaction-map.md: five worker forms already
// rendered a dropdown of the company's real sites, then stored only the
// resolved NAME. Nothing could join an FLHA to a monthly inspection at the
// same place, because one carried text and the other carried a foreign key.
//
// The dropdown's <option value> is the site name, so the id has to be looked
// up from the list the form already loaded. Getting this wrong in either
// direction is bad in a way nobody can see: a missed match silently produces
// an unjoinable record, and a WRONG match silently attributes an incident to
// the wrong place.
//
// What these cases exist to stop coming back:
//   * fuzzy or prefix matching creeping in;
//   * the "other / not in the list" path resolving to an id anyway;
//   * a blank or unloaded list throwing instead of returning null.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { siteIdForName } = await import('../../src/siteLookup.js');

const sites = [
  { id: 1, name: 'Camrose County' },
  { id: 2, name: 'Caroline Gas Station' },
  { id: 3, name: 'Red Deer County' },
];

test('a picked site resolves to its id', () => {
  assert.equal(siteIdForName(sites, 'Caroline Gas Station', 'list'), 2);
});

test('casing and surrounding space do not matter', () => {
  // Real data had "Lacombe county" alongside "Lacombe County". The backfill
  // in the migration matches the same way, so the two must agree.
  assert.equal(siteIdForName(sites, 'camrose county', 'list'), 1);
  assert.equal(siteIdForName(sites, '  Red Deer County  ', 'list'), 3);
});

test('the "other" path never resolves to an id', () => {
  // A worker who chose "Other site" and typed something that happens to
  // match an existing name still meant a different place, and the record
  // keeps only its text.
  assert.equal(siteIdForName(sites, 'Camrose County', 'other'), null);
});

test('a site that is not in the list stays unlinked', () => {
  assert.equal(siteIdForName(sites, 'Somewhere Else', 'list'), null);
});

test('partial names never match', () => {
  // No fuzzy matching, deliberately: a wrong link is worse than no link,
  // because a supervisor cannot see that it happened.
  assert.equal(siteIdForName(sites, 'Camrose', 'list'), null);
  assert.equal(siteIdForName(sites, 'Camrose County North', 'list'), null);
  assert.equal(siteIdForName(sites, 'Gas Station', 'list'), null);
});

test('an empty or unloaded site list returns null rather than throwing', () => {
  // The form can submit before list_sites resolves, or for a company with
  // no sites configured at all.
  assert.equal(siteIdForName([], 'Camrose County', 'list'), null);
  assert.equal(siteIdForName(null, 'Camrose County', 'list'), null);
  assert.equal(siteIdForName(undefined, 'Camrose County', 'list'), null);
});

test('a blank selection returns null', () => {
  assert.equal(siteIdForName(sites, '', 'list'), null);
  assert.equal(siteIdForName(sites, '   ', 'list'), null);
  assert.equal(siteIdForName(sites, null, 'list'), null);
  assert.equal(siteIdForName(sites, undefined, 'list'), null);
});

test('a malformed site row cannot break the lookup', () => {
  const messy = [{ id: 1 }, { id: 2, name: null }, { id: 3, name: 'Real Site' }];
  assert.equal(siteIdForName(messy, 'Real Site', 'list'), 3);
  assert.equal(siteIdForName(messy, '', 'list'), null);
});
