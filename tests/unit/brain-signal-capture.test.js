// Pins which document types feed the Company Brain.
//
// The Brain is FORA's flagship: server-lib/companyBrainSummary.js rolls
// company_signals up into company_profiles, and src/companyProfile.js
// injects that profile into all eight document-generation prompts. What it
// never receives, it can never learn.
//
// Phase 3 of docs/scope-company-brain.md wired four sources — FLHA edits,
// toolbox talks, incidents and near misses — and deliberately left the rest
// for later. That left the Brain blind to equipment-inspection defects,
// which is the single most company-specific thing the product records:
// which checks actually fail, on which machines. api/logs.js emitted a
// signal for toolbox talks and none for the inspections flowing through the
// very same handler. Nothing errored; the Brain just stayed ignorant.
//
// What these cases exist to stop coming back:
//   * a clean inspection writing a signal row full of empty arrays;
//   * a failing inspection writing nothing;
//   * unbounded arrays or strings reaching the batch prompt;
//   * a new source_type being added without the Brain tab learning to
//     count it, which would make a captured signal invisible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1/';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SESSION_SECRET ||= 'test-session-secret';

const { inspectionFindingSignal } = await import('../../api/logs.js');

const item = (name, condition) => ({ item: name, category: 'Fluids & Engine Compartment', condition });

test('a clean inspection produces no signal at all', () => {
  // Thirty "Good" items say nothing a company profile should emphasize.
  // Writing a row anyway would dilute every real finding in the batch.
  const signal = inspectionFindingSignal({
    equipment_label: '2019 CAT 336 Excavator (Unit 12)',
    results_json: { items: [item('Engine oil level', 'Good'), item('Coolant level', 'Good')] },
  });
  assert.equal(signal, null);
});

test('defective and monitor items are both captured, with the machine', () => {
  const signal = inspectionFindingSignal({
    equipment_label: '2019 CAT 336 Excavator (Unit 12)',
    results_json: {
      items: [
        item('Engine oil level', 'Good'),
        item('Hydraulic fluid level', 'Defective'),
        item('Belts, pulleys, hoses, radiator fins', 'Monitor'),
        item('Air filter / restriction gauge', 'N/A'),
      ],
    },
  });
  assert.deepEqual(signal.defective, ['Hydraulic fluid level']);
  assert.deepEqual(signal.monitor, ['Belts, pulleys, hoses, radiator fins']);
  assert.equal(signal.equipment, '2019 CAT 336 Excavator (Unit 12)');
});

test('a machine with no label still records its findings', () => {
  // equipment_label is free text and can be blank. The finding is still
  // worth learning from; it just loses the "on what" half.
  const signal = inspectionFindingSignal({
    equipment_label: '   ',
    results_json: { items: [item('Hydraulic fluid level', 'Defective')] },
  });
  assert.deepEqual(signal.defective, ['Hydraulic fluid level']);
  assert.equal('equipment' in signal, false);
});

test('a missing or malformed results_json is skipped, not thrown on', () => {
  // These run best-effort after the inspection is already saved. A throw
  // here would be swallowed and the signal lost silently, so the function
  // must simply decline.
  assert.equal(inspectionFindingSignal({}), null);
  assert.equal(inspectionFindingSignal({ results_json: null }), null);
  assert.equal(inspectionFindingSignal({ results_json: 'not an object' }), null);
  assert.equal(inspectionFindingSignal({ results_json: {} }), null);
  assert.equal(inspectionFindingSignal({ results_json: { items: 'nope' } }), null);
  assert.equal(inspectionFindingSignal(null), null);
});

test('items with no usable name are dropped', () => {
  const signal = inspectionFindingSignal({
    results_json: {
      items: [
        { item: '', condition: 'Defective' },
        { item: '   ', condition: 'Defective' },
        { condition: 'Defective' },
        null,
        item('Track tension', 'Defective'),
      ],
    },
  });
  assert.deepEqual(signal.defective, ['Track tension']);
});

test('item names and list lengths are capped', () => {
  // One inspection of a very long checklist must not be able to dominate
  // the batch prompt in server-lib/companyBrainSummary.js.
  const many = Array.from({ length: 40 }, (_, i) => item(`Check ${i}`, 'Defective'));
  const signal = inspectionFindingSignal({
    equipment_label: 'x'.repeat(500),
    results_json: { items: [...many, item('y'.repeat(500), 'Monitor')] },
  });
  assert.equal(signal.defective.length, 12);
  assert.equal(signal.equipment.length, 200);
  assert.equal(signal.monitor[0].length, 200);
});

test('a post-trip change is captured like any other defect', () => {
  // submitPosttrip writes a single-item results_json when the operator
  // reports a change, which is exactly when in-service damage is caught.
  const signal = inspectionFindingSignal({
    equipment_label: 'Kenworth T800 (Unit 4)',
    results_json: { items: [item('Rear tire — sidewall damage', 'Defective')], defectiveCount: 1, monitorCount: 0 },
  });
  assert.deepEqual(signal.defective, ['Rear tire — sidewall damage']);
});

test('every source_type a writer emits is counted by the trends endpoint', () => {
  // api/companydata.js's bySourceType drops any source_type missing from
  // its map, so a captured signal would be recorded and summarized but
  // invisible in the Admin Panel's Brain tab. This asserts the two lists
  // agree, which is the exact drift this whole change exists to close.
  const writers = ['flha_edit', 'toolbox_talk', 'incident', 'near_miss', 'equipment_inspection', 'monthly_inspection'];
  const source = readFileSync(new URL('../../api/companydata.js', import.meta.url), 'utf8');
  const declared = source.match(/const bySourceType = \{([^}]*)\}/)[1];
  for (const w of writers) {
    assert.ok(declared.includes(`${w}:`), `bySourceType is missing "${w}", so its signals would be silently uncounted`);
  }
});
