import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas } from './helpers.js';

test.describe('Equipment Inspection', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await page.getByText('Equipment Inspection').click();
  });

  test('picks the excavator checklist for a fleet machine and completes a signed submission', async ({ page }) => {
    await expect(page.getByText('Select equipment')).toBeVisible();
    // Fleet machine has a unit number — the picker should show the concise
    // "UNIT n, Type" form, not the full year/make/model text.
    await page.locator('select').selectOption({ label: 'UNIT 12, Excavator' });
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText('Inspector')).toBeVisible();
    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Inspector');
    await page.getByPlaceholder('e.g. 1245.3').fill('1000');
    await page.getByRole('button', { name: 'Start Inspection' }).click();

    // Excavator-specific items — should not appear on a truck's checklist.
    await expect(page.getByText('Boom cylinders, hoses, and pins')).toBeVisible();
    await expect(page.getByText('Swing drive, swing motor, and swing gear fluid')).toBeVisible();
    await expect(page.getByText('Hydraulic cut-out / lockout lever function')).toBeVisible();
    // A truck-only item should NOT be on the excavator's checklist.
    await expect(page.getByText('Load box / deck')).not.toBeVisible();
    // "Wire wrap" phrasing is gone in favor of standard track-cleanliness wording.
    await expect(page.getByText(/wire wrap/i)).not.toBeVisible();
    await expect(page.getByText('Tracks (or wheels, if wheeled) clean, free of debris, nothing wrapped around them')).toBeVisible();

    // Flag one item as Defective and confirm the counter updates.
    const boomCard = page.getByText('Boom cylinders, hoses, and pins', { exact: true }).locator('..');
    await boomCard.getByRole('button', { name: 'Defective' }).click();
    await expect(page.getByText('1 defective')).toBeVisible();
    await page.getByPlaceholder("Add a note (what's wrong?)").fill('Small leak near the fitting.');

    // N/A is available as a fourth condition and doesn't count toward the
    // defective/monitor totals.
    const swingCard = page.getByText('Swing drive, swing motor, and swing gear fluid', { exact: true }).locator('..');
    await swingCard.getByRole('button', { name: 'N/A' }).click();
    await expect(page.getByText('1 defective')).toBeVisible();
    await expect(page.getByText(/\d+ monitor\b/)).not.toBeVisible();

    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Pre-Trip Inspection' }).click();

    await expect(page.getByText('Pre-Trip Complete')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('1 defective item flagged')).toBeVisible();
  });

  test('picks the leaner pickup checklist (not the service/deck truck one) for a free-text rental entry', async ({ page }) => {
    await expect(page.getByText('Select equipment')).toBeVisible();
    await page.locator('select').selectOption('__other__');

    await page.getByPlaceholder('e.g. 2019').fill('2022');
    await page.getByPlaceholder('e.g. Caterpillar').fill('Ford');
    await page.getByPlaceholder('e.g. 320').fill('F350');
    await page.getByPlaceholder('e.g. Excavator').fill('Pickup Truck');
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText('Inspector')).toBeVisible();
    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Inspector');
    await page.getByPlaceholder('e.g. 1245.3').fill('42000');
    await page.getByRole('button', { name: 'Start Inspection' }).click();

    // Pickup-specific items — leaner than the deck/crane service truck template.
    await expect(page.getByText('Truck bed / cargo area — tie-downs, load secured')).toBeVisible();
    await expect(page.getByText('Spare tire, jack, and lug wrench present')).toBeVisible();
    await expect(page.getByText('Service brake function/pedal feel')).toBeVisible();
    await expect(page.getByText('Seat belts — all positions')).toBeVisible();
    // Deck/crane-truck-only and excavator-only items should NOT be here.
    await expect(page.getByText('Crane/hoist, compressor, or welder mounting and function')).not.toBeVisible();
    await expect(page.getByText('Swing drive, swing motor, and swing gear fluid')).not.toBeVisible();

    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Pre-Trip Inspection' }).click();

    await expect(page.getByText('Pre-Trip Complete')).toBeVisible({ timeout: 15000 });
  });

  test('picks the semi/tractor-trailer checklist, not the pickup one, for a "Semi Truck" entry', async ({ page }) => {
    await expect(page.getByText('Select equipment')).toBeVisible();
    await page.locator('select').selectOption('__other__');

    await page.getByPlaceholder('e.g. 2019').fill('2020');
    await page.getByPlaceholder('e.g. Caterpillar').fill('Kenworth');
    await page.getByPlaceholder('e.g. 320').fill('T800');
    await page.getByPlaceholder('e.g. Excavator').fill('Semi Truck');
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText('Inspector')).toBeVisible();
    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Inspector');
    await page.getByPlaceholder('e.g. 1245.3').fill('180000');
    await page.getByRole('button', { name: 'Start Inspection' }).click();

    // Semi-specific items should be present...
    await expect(page.getByText('Fifth wheel — locking jaw, release arm, mounting, and lubrication')).toBeVisible();
    await expect(page.getByText('Trailer coupling — kingpin engagement and locking pins')).toBeVisible();
    await expect(page.getByText('Log book / ELD present and current')).toBeVisible();
    // ...and pickup-only items should NOT be — this is the exact bug
    // report: "Semi truck and Pickup truck are pulling the same inspection."
    await expect(page.getByText('Spare tire, jack, and lug wrench present')).not.toBeVisible();
    await expect(page.getByText('Truck bed / cargo area — tie-downs, load secured')).not.toBeVisible();

    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Pre-Trip Inspection' }).click();

    await expect(page.getByText('Pre-Trip Complete')).toBeVisible({ timeout: 15000 });
  });

  test('a "5x10 dump trailer" gets the dump trailer checklist, not a generic engine-equipped one', async ({ page }) => {
    await expect(page.getByText('Select equipment')).toBeVisible();
    await page.locator('select').selectOption('__other__');

    await page.getByPlaceholder('e.g. 320').fill('5x10');
    await page.getByPlaceholder('e.g. Excavator').fill('Dump Trailer');
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText('Inspector')).toBeVisible();
    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Inspector');
    // Trailers skip the hours/km reading step entirely — see the dedicated
    // test for that behavior.
    await page.getByRole('button', { name: 'Start Inspection' }).click();

    // Trailer-specific items should be present...
    await expect(page.getByText('Coupler/hitch — condition, locking pin/latch')).toBeVisible();
    await expect(page.getByText('Dump mechanism (hoist cylinder or bottom-dump gate/apron) — condition and operation')).toBeVisible();
    // ...and it must NOT get engine/fluids items — this is the exact bug
    // report: a towed trailer with no engine got a checklist that included
    // "engine oil".
    await expect(page.getByText('Engine oil level')).not.toBeVisible();
    await expect(page.getByText('Coolant level')).not.toBeVisible();
  });

  test('a Keith walking floor trailer gets its own checklist, distinct from a dump trailer', async ({ page }) => {
    await expect(page.getByText('Select equipment')).toBeVisible();
    await page.locator('select').selectOption('__other__');

    await page.getByPlaceholder('e.g. Excavator').fill('Keith Walking Floor Trailer');
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText('Inspector')).toBeVisible();
    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Inspector');
    await page.getByRole('button', { name: 'Start Inspection' }).click();

    await expect(page.getByText('Hydraulic drive cylinders and slat drive mechanism — condition')).toBeVisible();
    await expect(page.getByText('Floor slats — alignment, wear strips, and slide condition')).toBeVisible();
    // Should not get the dump trailer's hoist/tailgate items or any engine items.
    await expect(page.getByText('Dump mechanism (hoist cylinder or bottom-dump gate/apron) — condition and operation')).not.toBeVisible();
    await expect(page.getByText('Engine oil level')).not.toBeVisible();
  });

  async function routeAddEquipmentCapture(page, addedEquipment) {
    await page.route('**/api/companydata', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'add_equipment') {
        addedEquipment.push(body);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      if (body.action === 'list_sites') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sites: [{ id: 'site-1', name: 'Test Site' }] }) });
      }
      if (body.action === 'list_equipment') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ equipment: [{ id: 'eq-1', year: '2019', make: 'Caterpillar', model: '320', type: 'Excavator', unit_number: '12' }] }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ logo_url: '' }) });
    });
  }

  async function submitRentalInspection(page, { year, make, model, type, unit }) {
    await page.locator('select').selectOption('__other__');
    await page.getByPlaceholder('e.g. 2019').fill(year);
    await page.getByPlaceholder('e.g. Caterpillar').fill(make);
    await page.getByPlaceholder('e.g. 320').fill(model);
    await page.getByPlaceholder('e.g. Excavator').fill(type);
    if (unit) await page.getByPlaceholder('e.g. 56').fill(unit);
    await page.getByRole('button', { name: 'Continue →' }).click();

    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Inspector');
    await page.getByPlaceholder('e.g. 1245.3').fill('500');
    await page.getByRole('button', { name: 'Start Inspection' }).click();
    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Pre-Trip Inspection' }).click();
    await expect(page.getByText('Pre-Trip Complete')).toBeVisible({ timeout: 15000 });
  }

  test('registering a unit number on a rental adds it to the fleet', async ({ page }) => {
    const addedEquipment = [];
    await routeAddEquipmentCapture(page, addedEquipment);

    await submitRentalInspection(page, { year: '2023', make: 'John Deere', model: '310', type: 'Backhoe', unit: '99' });

    expect(addedEquipment).toHaveLength(1);
    expect(addedEquipment[0].unitNumber).toBe('99');
  });

  test('a plain rental with no unit number is NOT auto-added to the fleet', async ({ page }) => {
    const addedEquipment = [];
    await routeAddEquipmentCapture(page, addedEquipment);

    await submitRentalInspection(page, { year: '2023', make: 'John Deere', model: '310', type: 'Backhoe', unit: '' });

    expect(addedEquipment).toHaveLength(0);
  });

  test('a trailer skips the hours/km reading step entirely', async ({ page }) => {
    await page.locator('select').selectOption('__other__');
    await page.getByPlaceholder('e.g. Excavator').fill('Dump Trailer');
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText('Inspector')).toBeVisible();
    // No reading fields at all for a trailer.
    await expect(page.getByText('Reading type')).not.toBeVisible();
    await expect(page.getByText('Starting reading')).not.toBeVisible();
    // Name alone is enough to proceed.
    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Inspector');
    await expect(page.getByRole('button', { name: 'Start Inspection' })).toBeEnabled();
    await page.getByRole('button', { name: 'Start Inspection' }).click();

    // The inspect step shouldn't show a starting-reading line either.
    await expect(page.getByText(/^Starting reading:/)).not.toBeVisible();

    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Pre-Trip Inspection' }).click();
    await expect(page.getByText('Pre-Trip Complete')).toBeVisible({ timeout: 15000 });
  });

  test('a non-tow-capable machine (excavator) gets no "attach a trailer" option', async ({ page }) => {
    await page.locator('select').selectOption({ label: 'UNIT 12, Excavator' });
    await page.getByRole('button', { name: 'Continue →' }).click();
    await expect(page.getByText('Inspector')).toBeVisible();
    await expect(page.getByText('Attach a trailer?')).not.toBeVisible();
  });

  test('a tow-capable unit offers to attach a trailer, and it\'s carried into the submitted record', async ({ page }) => {
    let submittedRecord = null;
    await page.route('**/api/logs', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'submit') {
        submittedRecord = body.record;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-log-id' }) });
      }
      if (body.action === 'check_equipment') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ openPretrip: null, lastInspection: null }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.locator('select').selectOption('__other__');
    await page.getByPlaceholder('e.g. Excavator').fill('Pickup Truck');
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText('Inspector')).toBeVisible();
    await expect(page.getByText('Attach a trailer? (optional)')).toBeVisible();
    await page.getByPlaceholder('e.g. 5x10 Dump Trailer (Unit 7)').fill('5x10 Dump Trailer (Unit 7)');

    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Inspector');
    await page.getByPlaceholder('e.g. 1245.3').fill('42000');
    await page.getByRole('button', { name: 'Start Inspection' }).click();

    await expect(page.getByText('Trailer attached: 5x10 Dump Trailer (Unit 7)')).toBeVisible();

    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Pre-Trip Inspection' }).click();
    await expect(page.getByText('Pre-Trip Complete')).toBeVisible({ timeout: 15000 });

    expect(submittedRecord.results_json.attachedTrailer).toEqual({ id: null, label: '5x10 Dump Trailer (Unit 7)' });
  });
});
