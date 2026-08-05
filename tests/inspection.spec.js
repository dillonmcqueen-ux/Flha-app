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
    await page.locator('select').selectOption({ label: '2019 Caterpillar 320 Excavator (Unit 12)' });
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

    // Flag one item as Defective and confirm the counter updates.
    const boomCard = page.getByText('Boom cylinders, hoses, and pins', { exact: true }).locator('..');
    await boomCard.getByRole('button', { name: 'Defective' }).click();
    await expect(page.getByText('1 defective')).toBeVisible();
    await page.getByPlaceholder("Add a note (what's wrong?)").fill('Small leak near the fitting.');

    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Pre-Trip Inspection' }).click();

    await expect(page.getByText('Pre-Trip Complete')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('1 defective item flagged')).toBeVisible();
  });

  test('picks the pickup/service truck checklist for a free-text rental entry', async ({ page }) => {
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

    // Truck-specific items — should not appear on the excavator's checklist.
    await expect(page.getByText('Load box / deck — tie-downs, secured equipment')).toBeVisible();
    await expect(page.getByText('Service brake function/pedal feel')).toBeVisible();
    await expect(page.getByText('Seat belts — all positions')).toBeVisible();
    // An excavator-only item should NOT be on the truck's checklist.
    await expect(page.getByText('Swing drive, swing motor, and swing gear fluid')).not.toBeVisible();

    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Pre-Trip Inspection' }).click();

    await expect(page.getByText('Pre-Trip Complete')).toBeVisible({ timeout: 15000 });
  });
});
