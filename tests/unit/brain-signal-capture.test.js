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
import { readFileSync, readdirSync } from 'node:fs';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:1/';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SESSION_SECRET ||= 'test-session-secret';

const { inspectionFindingSignal,
  dailyConditionsSignal,
} = await import('../../api/logs.js');

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
  //
  // The writer list is SCANNED from api/, not hardcoded. An earlier version
  // of this test hardcoded it, which meant the guard itself went stale the
  // moment a writer was added -- the same failure it exists to catch, one
  // level up. Adding daily_report is what exposed that.
  const apiDir = new URL('../../api/', import.meta.url);
  const literals = new Set();
  for (const file of readdirSync(apiDir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(new URL(file, apiDir), 'utf8');
    for (const m of src.matchAll(/source_type: '([a-z_]+)'/g)) literals.add(m[1]);
    // Ternary writers, e.g. api/reports.js's
    // `source_type: type === 'incident' ? 'incident' : 'near_miss'`.
    for (const m of src.matchAll(/source_type: [^,\n]*\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)'/g)) {
      literals.add(m[1]);
      literals.add(m[2]);
    }
  }

  // Corrective-action source types are a different vocabulary on a
  // different table and are deliberately not Brain signals -- they derive
  // from findings the Brain already sees, so counting them would
  // double-count. Excluded by name so the exclusion is visible rather than
  // implicit in a regex.
  const notBrainSignals = new Set(['monthly_answer']);
  const writers = [...literals].filter((t) => !notBrainSignals.has(t));

  assert.ok(writers.length >= 6, `expected to find the Brain writers by scanning api/, found ${writers.length}: ${writers.join(', ')}`);

  const source = readFileSync(new URL('../../api/companydata.js', import.meta.url), 'utf8');
  const declared = source.match(/const bySourceType = \{([^}]*)\}/)[1];
  for (const w of writers) {
    assert.ok(declared.includes(`${w}:`), `bySourceType is missing "${w}", so its signals would be silently uncounted`);
  }
});

test('every counted source_type also reaches the prompt the model actually sees', () => {
  // bySourceType only feeds the Admin Panel tile. A type can be counted
  // there and still contribute nothing to the profile, which is the
  // half-wired state break #4 describes: captured, summarized, invisible.
  const declared = readFileSync(new URL('../../api/companydata.js', import.meta.url), 'utf8')
    .match(/const bySourceType = \{([^}]*)\}/)[1];
  const counted = [...declared.matchAll(/([a-z_]+):/g)].map((m) => m[1]);
  const prompt = readFileSync(new URL('../../server-lib/companyBrainSummary.js', import.meta.url), 'utf8');
  for (const t of counted) {
    assert.ok(prompt.includes(`'${t}'`), `companyBrainSummary.js never branches on "${t}", so its signals never reach the model`);
  }
});

// ── Break #4's daily-report half ────────────────────────────────────────
//
// Daily reports were left out of PR #118 on purpose: crew, visitors and the
// narrative are free text with no structured finding, and feeding raw prose
// to the Brain dilutes the signal that makes a profile company-specific.
// Two fields are not prose, though -- weather is a pick from a fixed list
// and temperature parses to a number -- and together they are the one thing
// no other document type tells the Brain.
//
// What these cases exist to stop coming back:
//   * free text creeping in through the weather field and turning this back
//     into a prose signal;
//   * a typo'd temperature being tallied as a real working condition;
//   * an empty daily report writing a row that says nothing.

test('conditions and temperature become a signal', () => {
  const signal = dailyConditionsSignal({ weather: 'Snow, Windy', temperature: '-35°C' });
  assert.deepEqual(signal.conditions, ['Snow', 'Windy']);
  assert.equal(signal.temperature, -35);
  assert.equal(signal.tempBand, 'extreme_cold');
});

test('weather outside the fixed vocabulary is dropped, not tallied', () => {
  // The vocabulary mirrors src/DailyReport.jsx. Anything else means the
  // field changed shape, and a prose weather value must not silently become
  // a counted "condition".
  const signal = dailyConditionsSignal({ weather: 'Blizzard, Snow', temperature: '' });
  assert.deepEqual(signal.conditions, ['Snow']);
});

test('an unparseable temperature is absent rather than guessed', () => {
  const signal = dailyConditionsSignal({ weather: 'Clear', temperature: 'chilly' });
  assert.equal(signal.temperature, undefined);
  assert.equal(signal.tempBand, undefined);
});

test('an out-of-range temperature is rejected', () => {
  // "180" is a typo, not a jobsite. A tallied nonsense band is worse than
  // no band.
  const signal = dailyConditionsSignal({ weather: 'Clear', temperature: '180' });
  assert.equal(signal.temperature, undefined);
  assert.deepEqual(signal.conditions, ['Clear']);
});

test('a daily report with nothing structured writes no row at all', () => {
  assert.equal(dailyConditionsSignal({ weather: '', temperature: '' }), null);
  assert.equal(dailyConditionsSignal({}), null);
  assert.equal(dailyConditionsSignal(null), null);
});

test('negative temperatures parse, including bare numbers', () => {
  // The band boundaries are inclusive at the cold end: -20 is already
  // extreme cold on an Alberta jobsite, not merely freezing.
  assert.equal(dailyConditionsSignal({ weather: '', temperature: '-20' }).tempBand, 'extreme_cold');
  assert.equal(dailyConditionsSignal({ weather: '', temperature: '-19' }).tempBand, 'freezing');
  assert.equal(dailyConditionsSignal({ weather: '', temperature: '35' }).tempBand, 'extreme_heat');
  assert.equal(dailyConditionsSignal({ weather: '', temperature: '18°C' }).tempBand, 'moderate');
});

test('crew, visitors and the narrative never reach the signal', () => {
  const signal = dailyConditionsSignal({
    weather: 'Clear', temperature: '18',
    crew: 'Dave, Priya, and a subcontractor', visitors: 'Safety officer from head office',
    report_json: { workDone: 'Poured the north footing' },
  });
  assert.deepEqual(Object.keys(signal).sort(), ['conditions', 'tempBand', 'temperature']);
});

test('repeated weather picks are deduped before they reach the tally', () => {
  // The vocabulary is closed, so "Snow, Snow, Snow" carries no more
  // information than "Snow". api/companydata.js bumps the working-conditions
  // tally once per element, so without the dedupe a single daily report
  // could add 12 to one condition's count and skew its own company's Brain
  // profile. Found by tenant-scope-reviewer; within-tenant only, but free to
  // fix and unambiguously correct given the fixed vocabulary.
  const signal = dailyConditionsSignal({ weather: 'Snow, Snow, Snow, Windy, Snow', temperature: '' });
  assert.deepEqual(signal.conditions, ['Snow', 'Windy']);
});
