import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas } from './helpers.js';

test.describe('FLHA (Field Level Hazard Assessment)', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await page.getByText('FLHA', { exact: true }).click();
  });

  test('walks setup through AI-generated hazards to a signed submission', async ({ page }) => {
    await expect(page.getByText('Site & Worker Info')).toBeVisible();
    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Worker');
    await page.locator('select').selectOption('Test Site');
    await page.getByRole('button', { name: 'Continue to Voice Input →' }).click();

    await expect(page.getByText('Describe Your Task')).toBeVisible();
    await page.locator('textarea').fill('Operating an excavator near an active roadway, digging a trench for a water line.');
    await page.getByRole('button', { name: '✅ Generate FLHA' }).click();

    await expect(page.getByText('Job Hazard Analysis')).toBeVisible();
    await expect(page.getByText('Struck-by hazard from moving equipment')).toBeVisible();
    await expect(page.getByText('Hard hat')).toBeVisible();

    await page.getByRole('button', { name: 'Continue to Sign-Off →' }).click();
    await expect(page.getByText('Worker Sign-Off')).toBeVisible();

    const submitBtn = page.getByRole('button', { name: /Sign & Submit FLHA/ });
    await expect(submitBtn).toBeDisabled();
    await signCanvas(page);
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect(page.getByText('FLHA Complete')).toBeVisible({ timeout: 15000 });
  });
});
