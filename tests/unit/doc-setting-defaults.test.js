// Pins which way a MISSING company_document_settings row resolves.
//
// This is break #6's direction, and it was live. `documentSettingsFor`
// provisions a row for every key a module can unlock, so a company that came
// through checkout has an explicit answer for all of them. A company created
// outside that path, or a key added to BUILTIN_DOC_KEYS after a company was
// provisioned, has no row — and the old default read that as ACTIVE, so the
// feature shipped free with no error and nothing in a log.
//
// Found live on 2026-09-18 across all three companies in the database: one
// was running six document types nobody had decided to give it, another all
// twelve. The rows were backfilled to match what each company was already
// seeing, so flipping the default changed nobody's experience; these cases
// stop it drifting back.
//
// The two defaults are deliberately OPPOSITE, which is the part most likely
// to get "tidied" into consistency by a later pass:
//
//   * a BUILT-IN key is something a company BUYS. No decision means not
//     bought, so it is off. This is what makes adding a new module safe.
//   * a CUSTOM form is something this company's own admin BUILT here. No
//     decision means they just made it. Denying by default would hide every
//     new custom form until its creator switched on the thing they had just
//     created.
//
// Both handlers have to agree, too: a worker seeing a form the supervisor's
// own settings screen says is off would be worse than either default.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allDocumentSettingsOn, documentSettingsFor, MODULE_KEYS, MODULES } from '../../server-lib/pricing.js';

const SRC = readFileSync(new URL('../../api/customforms.js', import.meta.url), 'utf8');

// Read the resolution expressions out of the source rather than standing up
// a database: the whole invariant is which way a one-line ternary falls, and
// that is exactly what a later edit would change.
function occurrences(pattern) {
  return (SRC.match(pattern) || []).length;
}

test('a built-in key with no settings row resolves to OFF, in both handlers', () => {
  // get_document_settings (the supervisor's list) and get_worker_documents
  // (the worker's menu).
  assert.equal(occurrences(/settingsMap\[key\] === true/g), 2,
    'both handlers must read a missing built-in row as inactive');
});

test('no built-in resolution defaults to true any more', () => {
  assert.equal(occurrences(/settingsMap\[key\] !== undefined \? settingsMap\[key\] : true/g), 0,
    'the allow-by-default built-in resolution is what gave features away for free');
});

test('a custom form with no settings row still resolves to ON, in both handlers', () => {
  assert.equal(occurrences(/settingsMap\[`custom_\$\{f\.id\}`\] !== false/g), 2,
    'a form the admin just built must not be invisible until they toggle it');
});

test('the two defaults are actually different, which is the point', () => {
  // If a later pass "makes them consistent" in either direction, one of
  // these two counts goes to zero and this fails.
  assert.ok(occurrences(/settingsMap\[key\] === true/g) > 0, 'built-ins deny by default');
  assert.ok(occurrences(/!== false/g) > 0, 'custom forms allow by default');
});

// ── the rule the defaults exist to serve ────────────────────────────────

const pricing = await import('../../server-lib/pricing.js');

test('provisioning writes a row for every built-in key, so a bought company never relies on the default', () => {
  const rows = pricing.documentSettingsFor(42, ['safety']);
  const keys = rows.map(r => r.document_key).sort();
  assert.deepEqual(keys, [...pricing.ALL_DOC_KEYS].sort(),
    'every key a module can unlock needs an explicit row at provisioning time');

  // And the ones they did not buy are explicitly off, not merely absent.
  const safetyKeys = new Set(pricing.MODULES.safety.docKeys);
  rows.forEach(r => {
    assert.equal(r.is_active, safetyKeys.has(r.document_key),
      `${r.document_key} should be ${safetyKeys.has(r.document_key)} for a safety-only company`);
  });
});

// ── Break #20: a company that never went through a checkout ──────────────
// edd7a41 flipped a missing company_document_settings row from active to off.
// That is right for billing, but nothing wrote rows for a company created
// outside a purchase, so the flip silently took every document type away from
// hand-created companies. These pin the restored behaviour: such a company
// gets everything, written down rather than inferred from an empty table.

test('allDocumentSettingsOn switches on every key, with no key left out', () => {
  const rows = allDocumentSettingsOn(42);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(r => r.is_active === true), 'every row must be active');
  assert.ok(rows.every(r => r.company_id === 42), 'every row must carry the company id');
  const keys = rows.map(r => r.document_key).sort();
  assert.deepEqual(keys, [...new Set(keys)].sort(), 'no duplicate keys');
});

test('it covers exactly the built-in keys the gate reads, not a stale subset', () => {
  // The whole failure mode of #20 is a key with no row. If a module is added
  // and this drifts, a new company silently loses that document type again.
  //
  // BUILTIN_DOC_KEYS is a module-level const in an api/ handler, not an
  // export, so read it out of the source the same way the cases above read
  // the resolution expressions — that checks the list the gate actually uses
  // rather than a copy of it kept in this file.
  const m = SRC.match(/const BUILTIN_DOC_KEYS = \[([^\]]+)\]/);
  assert.ok(m, 'could not find BUILTIN_DOC_KEYS in api/customforms.js');
  const builtin = m[1].split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.equal(builtin.length, 13, 'expected 13 built-in keys');

  const covered = allDocumentSettingsOn(1).map(r => r.document_key).sort();
  assert.deepEqual(covered, [...builtin].sort());
});

test('a module added later is switched on without editing this helper', () => {
  // Derived from MODULE_KEYS rather than a hardcoded list, so the next module
  // does not need anyone to remember to come back here.
  const covered = new Set(allDocumentSettingsOn(1).map(r => r.document_key));
  for (const key of MODULE_KEYS.flatMap(k => MODULES[k].docKeys)) {
    assert.ok(covered.has(key), `module key ${key} missing from the on-by-default set`);
  }
});

test('a purchased request still gets only what it bought', () => {
  // The #20 fix must not become "everyone gets everything".
  const rows = documentSettingsFor(7, ['daily']);
  const on = rows.filter(r => r.is_active).map(r => r.document_key);
  assert.deepEqual(on, ['daily']);
  assert.ok(rows.length > 1, 'the unbought keys must still be written, explicitly off');
});
