import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker } from './helpers.js';

test.describe('Daily Report', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await page.getByText('Daily Report').click();
  });

  test('captures equipment picks and weather, then generates and submits a report', async ({ page }) => {
    await page.getByPlaceholder('Reporter name').fill('Jamie Worker');
    await page.locator('select').selectOption('Test Site');
    await page.getByRole('button', { name: 'Rain' }).click();
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText('Crew, equipment & visitors')).toBeVisible();
    await page.locator('select').selectOption({ label: '2019 Caterpillar 320 Excavator (Unit 12)' });
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('span').filter({ hasText: 'Caterpillar 320' })).toBeVisible();

    await page.getByPlaceholder(/dug footings north side/).fill('Dug footings on the north side and poured two piers.');
    await page.getByRole('button', { name: 'Generate Report' }).click();

    await expect(page.getByText('Work Completed')).toBeVisible();
    await expect(page.locator('textarea').first()).toHaveValue(/footing excavation/);

    await page.getByRole('button', { name: 'Submit Daily Report' }).click();
    await expect(page.getByText('Daily Report Submitted')).toBeVisible({ timeout: 15000 });
  });
});
