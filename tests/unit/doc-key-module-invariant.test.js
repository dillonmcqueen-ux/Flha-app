// Enforces the doc-key ↔ pricing-module invariant that break #6 in
// docs/feature-interaction-map.md found living only in a comment.
//
// server-lib/pricing.js says every key in api/customforms.js's
// BUILTIN_DOC_KEYS must appear in exactly one module, "or a company could be
// charged for something it cannot see, or see something it was not charged
// for." Nothing checked it.
//
// The failure has a direction, and it is the expensive one.
// api/customforms.js treats a MISSING company_document_settings row as
// ACTIVE, so a document key that no module sells does not get withheld — it
// ships to every company for free, silently, with no error and nothing in a
// log. The reverse (a module selling a key no document uses) bills for a
// feature that cannot be switched on.
//
// This is a pure consistency test on two literal lists. It needs no
// database and no session, which is exactly why the invariant should never
// have been a comment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pricing = await import('../../server-lib/pricing.js');

// Read the list out of api/customforms.js rather than importing it: it is a
// module-private const in a file that builds a Supabase client at import
// time, and the point here is to compare the two source-of-truth lists as
// they are actually written.
function builtinDocKeys() {
  const src = readFileSync(new URL('../../api/customforms.js', import.meta.url), 'utf8');
  const match = src.match(/const BUILTIN_DOC_KEYS = \[([^\]]*)\]/);
  assert.ok(match, 'BUILTIN_DOC_KEYS not found in api/customforms.js — this test cannot verify the invariant');
  return match[1].split(',').map((k) => k.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

test('every built-in document key is sold by exactly one pricing module', () => {
  const keys = builtinDocKeys();
  const owners = {};
  Object.entries(pricing.MODULES).forEach(([moduleName, mod]) => {
    (mod.docKeys || []).forEach((k) => {
      if (!owners[k]) owners[k] = [];
      owners[k].push(moduleName);
    });
  });

  const unsold = keys.filter((k) => !owners[k]);
  assert.deepEqual(unsold, [],
    `these document keys are in no pricing module, so every company gets them FREE (a missing settings row reads as active): ${unsold.join(', ')}`);

  const duplicated = Object.entries(owners).filter(([, mods]) => mods.length > 1);
  assert.deepEqual(duplicated, [],
    `these keys are sold by more than one module, so turning one off does not turn the feature off: ${duplicated.map(([k, m]) => `${k} (${m.join(' + ')})`).join(', ')}`);
});

test('no pricing module sells a document key that does not exist', () => {
  const keys = new Set(builtinDocKeys());
  const phantom = [];
  Object.entries(pricing.MODULES).forEach(([moduleName, mod]) => {
    (mod.docKeys || []).forEach((k) => { if (!keys.has(k)) phantom.push(`${k} (in ${moduleName})`); });
  });
  assert.deepEqual(phantom, [],
    `these modules bill for document keys no document uses: ${phantom.join(', ')}`);
});

test('ALL_DOC_KEYS covers the built-in list exactly', () => {
  // ALL_DOC_KEYS is what the rest of the app reasons about. If it drifts
  // from BUILTIN_DOC_KEYS, the two halves of the product disagree about
  // which documents exist at all.
  assert.deepEqual([...pricing.ALL_DOC_KEYS].sort(), builtinDocKeys().sort());
});

test('a module cannot depend on a module that does not exist', () => {
  // `requires` is a hard dependency resolveModules() enforces at checkout —
  // preventative maintenance cannot be bought without equipment
  // inspections. A typo here would either reject a legitimate purchase or
  // silently stop enforcing the dependency.
  const names = new Set(Object.keys(pricing.MODULES));
  Object.entries(pricing.MODULES).forEach(([moduleName, mod]) => {
    const requires = mod.requires ? (Array.isArray(mod.requires) ? mod.requires : [mod.requires]) : [];
    requires.forEach((r) => {
      assert.ok(names.has(r), `module "${moduleName}" requires "${r}", which is not a module`);
      assert.notEqual(r, moduleName, `module "${moduleName}" requires itself`);
    });
  });
});
