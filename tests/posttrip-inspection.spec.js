import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas, openForm } from './helpers.js';

// The exact flow Dillon walked on 2026-09-17: submit a pre-trip flagging a
// flat tire, then do the post-trip on the same machine.
//
// What he got: the post-trip never mentioned the tire, asked one "did
// anything change?" question, and produced nothing that closed the defect or
// recorded it as having happened before.
//
// These tests pin the post-trip as a real checklist that carries the
// morning's flags forward, and pin the submitted payload — because the
// payload is what api/logs.js turns into a corrective action, a resolution
// and a repair line. A post-trip that looks right on screen but posts the
// old shape would leave the whole server-side loop dead exactly the way it
// was before.

// A pre-trip left open on the excavator, with one Defective item and one
// Monitor item. This is what api/logs.js's check_equipment returns when the
// worker picks a machine they already pre-tripped today.
const OPEN_PRETRIP = {
  id: 'pretrip-1',
  worker_name: 'Jamie Inspector',
  equipment_label: '2019 Caterpillar 320 Excavator (Unit 12)',
  created_at: new Date().toISOString(),
  trip_type: 'pretrip',
  linked_inspection_id: null,
  start_reading: '1000',
  end_reading: null,
  reading_unit: 'Hours',
  has_changes: null,
  results_json: {
    items: [
      { item: 'Undercarriage: track adjustment and wear, tires (if wheeled)', category: 'Walkaround / Structure', unit: 'truck', unitLabel: '2019 Caterpillar 320 Excavator (Unit 12)', condition: 'Defective', note: 'front left tire flat' },
      { item: 'Engine oil level', category: 'Fluids & Engine Compartment', unit: 'truck', unitLabel: '2019 Caterpillar 320 Excavator (Unit 12)', condition: 'Monitor', note: 'a touch low' },
      { item: 'Coolant level', category: 'Fluids & Engine Compartment', unit: 'truck', unitLabel: '2019 Caterpillar 320 Excavator (Unit 12)', condition: 'Good', note: '' },
      { item: 'Boom cylinders, hoses, and pins', category: 'Hydraulics & Attachment', unit: 'truck', unitLabel: '2019 Caterpillar 320 Excavator (Unit 12)', condition: 'Good', note: '' },
    ],
  },
};

// Captures the record posted to api/logs so the assertions can read what the
// server would actually have received.
async function startPostTrip(page, { openPretrip = OPEN_PRETRIP } = {}) {
  const submitted = [];
  await page.route('**/api/logs', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'check_equipment') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ openPretrip, lastInspection: openPretrip }) });
    }
    if (body.action === 'submit') submitted.push(body.record);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-log-id' }) });
  });

  await page.locator('select').selectOption({ label: 'UNIT 12, Excavator' });
  await page.getByRole('button', { name: 'Continue →' }).click();
  await page.getByRole('button', { name: /Post-Trip/i }).click();
  return submitted;
}

test.describe('Post-Trip Inspection', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await openForm(page, 'Equipment Inspection');
  });

  test('carries the pre-trip flags forward and runs the same checklist', async ({ page }) => {
    await startPostTrip(page);

    // The flagged items are pinned at the top, with the morning's own note.
    // A defect that gets scrolled past is a defect nobody closes.
    await expect(page.getByText('Flagged this morning (2)')).toBeVisible();
    await expect(page.getByText('front left tire flat')).toBeVisible();
    await expect(page.getByText('a touch low')).toBeVisible();

    // And the rest of the checklist is the pre-trip's checklist, not a
    // single "did anything change?" question.
    await expect(page.getByText('End-of-shift checklist')).toBeVisible();
    await expect(page.getByText('Coolant level', { exact: true })).toBeVisible();
    await expect(page.getByText('Boom cylinders, hoses, and pins', { exact: true })).toBeVisible();
    await expect(page.getByText('Any changes since the Pre-Trip?')).not.toBeVisible();
  });

  test('a flagged item cannot be left unanswered', async ({ page }) => {
    await startPostTrip(page);
    await page.getByPlaceholder('e.g. John Smith').fill('Rob Operator');
    await page.getByPlaceholder('e.g. 1251.8').fill('1008');
    await signCanvas(page);

    const submit = page.getByRole('button', { name: 'Sign & Submit Post-Trip' });
    await expect(submit).toBeDisabled();

    // Answering one of the two is not enough.
    await page.getByRole('button', { name: 'Still an issue' }).first().click();
    await expect(submit).toBeDisabled();
  });

  test('marking an item fixed requires saying what was done', async ({ page }) => {
    // Without the note the repair log is empty, which is most of the value of
    // logging it at all.
    await startPostTrip(page);
    await page.getByPlaceholder('e.g. John Smith').fill('Rob Operator');
    await page.getByPlaceholder('e.g. 1251.8').fill('1008');
    await signCanvas(page);

    await page.getByRole('button', { name: 'Fixed' }).first().click();
    await page.getByRole('button', { name: 'Still an issue' }).nth(1).click();

    const submit = page.getByRole('button', { name: 'Sign & Submit Post-Trip' });
    await expect(submit).toBeDisabled();

    await page.getByPlaceholder(/What did you do\?/).fill('Plugged and aired up the front left tire');
    await expect(submit).toBeEnabled();
  });

  test('submits a checklist the server can turn into a resolution and a repair', async ({ page }) => {
    const submitted = await startPostTrip(page);

    await page.getByRole('button', { name: 'Fixed' }).first().click();
    await page.getByPlaceholder(/What did you do\?/).fill('Plugged and aired up the front left tire');
    await page.getByRole('button', { name: 'Still an issue' }).nth(1).click();

    await page.getByPlaceholder('e.g. John Smith').fill('Rob Operator');
    await page.getByPlaceholder('e.g. 1251.8').fill('1008');
    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Post-Trip' }).click();
    await expect(page.getByText('Post-Trip Complete')).toBeVisible({ timeout: 15000 });

    expect(submitted).toHaveLength(1);
    const record = submitted[0];
    expect(record.trip_type).toBe('posttrip');
    expect(record.linked_inspection_id).toBe('pretrip-1');
    expect(record.end_reading).toBe('1008');

    // The whole point: a post-trip now posts `items`. Before this change its
    // results_json had none, and server-lib/correctiveActions.js —which has
    // always read results.items — therefore opened nothing and closed
    // nothing, silently, for every post-trip ever submitted.
    const items = record.results_json.items;
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(4);

    const tire = items.find(i => i.item.startsWith('Undercarriage'));
    expect(tire.carriedFrom).toBe(true);
    expect(tire.carriedCondition).toBe('Defective');
    expect(tire.resolution).toBe('fixed');
    expect(tire.resolutionNote).toBe('Plugged and aired up the front left tire');
    // Fixed drives the condition to Good, so the resolution and the condition
    // can never disagree — the server reads `condition` to decide what opens
    // an action and `resolution` to decide what closes one.
    expect(tire.condition).toBe('Good');

    const oil = items.find(i => i.item === 'Engine oil level');
    expect(oil.resolution).toBe('still_open');
    expect(oil.condition).toBe('Monitor', 'an unresolved item keeps the condition the pre-trip gave it');
    expect(oil.note).toBe('a touch low', "and keeps the pre-trip's wording rather than going blank");

    // Untouched items default to Good, so an operator only has to touch what
    // is actually wrong.
    expect(items.find(i => i.item === 'Coolant level').condition).toBe('Good');

    // Derived fields the PDF, the dashboard row and the weekly equipment
    // report all still read.
    expect(record.results_json.resolvedCount).toBe(1);
    expect(record.results_json.defectiveCount).toBe(0);
    expect(record.results_json.monitorCount).toBe(1);
    expect(record.has_changes).toBe(true);
  });

  test('a new defect found at the end of the shift is captured', async ({ page }) => {
    const submitted = await startPostTrip(page);

    await page.getByRole('button', { name: 'Fixed' }).first().click();
    await page.getByPlaceholder(/What did you do\?/).fill('Plugged the tire');
    await page.getByRole('button', { name: 'Still an issue' }).nth(1).click();

    const boomCard = page.getByText('Boom cylinders, hoses, and pins', { exact: true }).locator('..');
    await boomCard.getByRole('button', { name: 'Defective' }).click();
    await boomCard.getByPlaceholder("Add a note (what's wrong?)").fill('Started weeping mid-shift');

    await page.getByPlaceholder('e.g. John Smith').fill('Rob Operator');
    await page.getByPlaceholder('e.g. 1251.8').fill('1008');
    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Post-Trip' }).click();
    await expect(page.getByText('Post-Trip Complete')).toBeVisible({ timeout: 15000 });

    const boom = submitted[0].results_json.items.find(i => i.item === 'Boom cylinders, hoses, and pins');
    expect(boom.condition).toBe('Defective');
    expect(boom.note).toBe('Started weeping mid-shift');
    expect(boom.carriedFrom).toBeUndefined();
    expect(submitted[0].results_json.defectiveCount).toBe(1);
  });

  test('a pre-trip with no stored checklist falls back to the short flow', async ({ page }) => {
    // Post-trips against pre-trips submitted before this change can still be
    // completed. It is a shrinking set — only pre-trips left open today —
    // and an uncompletable post-trip would strand a worker at the end of a
    // shift.
    const legacy = { ...OPEN_PRETRIP, results_json: { machineSummary: 'Excavator' } };
    const submitted = await startPostTrip(page, { openPretrip: legacy });

    await expect(page.getByText(/no checklist to carry over/i)).toBeVisible();
    await expect(page.getByText('Any changes since the Pre-Trip?')).toBeVisible();
    await expect(page.getByText('Flagged this morning')).not.toBeVisible();

    await page.getByRole('button', { name: 'No changes' }).click();
    await page.getByPlaceholder('e.g. John Smith').fill('Rob Operator');
    await page.getByPlaceholder('e.g. 1251.8').fill('1008');
    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Post-Trip' }).click();
    await expect(page.getByText('Post-Trip Complete')).toBeVisible({ timeout: 15000 });

    expect(submitted[0].results_json.items).toEqual([]);
    expect(submitted[0].has_changes).toBe(false);
  });
});
