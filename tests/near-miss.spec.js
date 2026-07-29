import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas } from './helpers.js';

test.describe('Near Miss report', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await page.getByText('Near Miss Report').click();
  });

  test('gates continue on required fields and lets anonymous reports skip the signature', async ({ page }) => {
    const continueBtn = page.getByRole('button', { name: 'Continue →' });
    await expect(continueBtn).toBeDisabled();

    // Reporter name is required until "Report anonymously" is checked.
    await page.getByPlaceholder('Reporter name').fill('Jamie Worker');
    await expect(continueBtn).toBeDisabled(); // still missing a site

    await page.locator('select').selectOption('Test Site');
    await expect(continueBtn).toBeEnabled();

    await page.getByText('Report anonymously').click();
    await expect(page.getByPlaceholder('Reporter name')).toHaveCount(0);
    await expect(continueBtn).toBeEnabled();

    await continueBtn.click();
    await page.locator('textarea').fill('Excavator swung without a spotter nearby.');
    await page.getByRole('button', { name: 'Generate Report' }).click();

    await expect(page.getByText('Near Miss Incident Report')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to Sign →' }).click();

    await expect(page.getByText('Confirm & Submit')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Submit Report' })).toBeEnabled();
  });

  test('walks a signed report through to submission', async ({ page }) => {
    await page.getByPlaceholder('Reporter name').fill('Jamie Worker');
    await page.locator('select').selectOption('Test Site');
    await page.getByPlaceholder('e.g. Excavator and a ground worker').fill('Excavator and a ground worker');
    await page.getByRole('button', { name: 'Continue →' }).click();

    await page.locator('textarea').fill('Excavator swung without a spotter nearby and nearly struck a worker.');
    await page.getByRole('button', { name: 'Generate Report' }).click();
    await expect(page.getByText('Near Miss Incident Report')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Medium', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Continue to Sign →' }).click();
    await expect(page.getByRole('button', { name: 'Sign & Submit Report' })).toBeDisabled();

    await signCanvas(page);
    const submitBtn = page.getByRole('button', { name: 'Sign & Submit Report' });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect(page.getByText('Near Miss Reported')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Test Site')).toBeVisible();
  });
});
