import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas } from './helpers.js';

test.describe('Equipment Inspection', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await page.getByText('Equipment Inspection').click();
  });

  test('runs a pre-trip inspection from fleet selection to a signed submission', async ({ page }) => {
    await expect(page.getByText('Select equipment')).toBeVisible();
    await page.locator('select').selectOption({ label: '2019 Caterpillar 320 Excavator (Unit 12)' });
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText('Inspector')).toBeVisible();
    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Inspector');
    await page.getByPlaceholder('e.g. 1245.3').fill('1000');
    await page.getByRole('button', { name: 'Generate Inspection' }).click();

    await expect(page.getByText('Check hydraulic hoses for leaks')).toBeVisible();
    await expect(page.getByText('Inspect tracks for wear or damage')).toBeVisible();

    // Flag one item as Defective and confirm the counter updates.
    const firstItemCard = page.getByText('Check hydraulic hoses for leaks', { exact: true }).locator('..');
    await firstItemCard.getByRole('button', { name: 'Defective' }).click();
    await expect(page.getByText('1 defective')).toBeVisible();
    await page.getByPlaceholder("Add a note (what's wrong?)").fill('Small leak near the fitting.');

    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Pre-Trip Inspection' }).click();

    await expect(page.getByText('Pre-Trip Complete')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('1 defective item flagged')).toBeVisible();
  });
});
