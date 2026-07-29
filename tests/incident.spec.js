import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas } from './helpers.js';

test.describe('Incident report', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await page.getByText('Incident Report').click();
  });

  test('gates the setup step on reporter and site', async ({ page }) => {
    const continueBtn = page.getByRole('button', { name: 'Continue →' });
    await expect(continueBtn).toBeDisabled();

    await page.getByPlaceholder('Reporter name').fill('Jamie Worker');
    await expect(continueBtn).toBeDisabled(); // still missing a site

    await page.locator('select').selectOption('Test Site');
    await expect(continueBtn).toBeEnabled();

    // Incident type selection updates the active option.
    await page.getByRole('button', { name: 'Vehicle Incident' }).click();
    await expect(page.getByRole('button', { name: 'Vehicle Incident' })).toHaveCSS('color', 'rgb(153, 27, 27)');
  });

  test('walks a signed incident through details, description, review, and submission', async ({ page }) => {
    await page.getByPlaceholder('Reporter name').fill('Jamie Worker');
    await page.locator('select').selectOption('Test Site');
    await page.getByRole('button', { name: 'Continue →' }).click();

    // Details step — everything here is optional, so Continue should already work.
    await expect(page.getByText('People & evidence')).toBeVisible();
    await page.getByPlaceholder('e.g. Left hand').fill('Left hand');
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText('What happened?')).toBeVisible();
    await page.locator('textarea').fill('Worker caught their hand while carrying a sheet of plywood in the wind.');
    await page.getByRole('button', { name: 'Generate Report' }).click();

    await expect(page.getByText('Injury / Illness — Incident Report')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Medium', exact: true })).toBeVisible();
    await expect(page.getByText('Summary')).toBeVisible();

    await page.getByRole('button', { name: 'Continue to Sign →' }).click();
    await expect(page.getByText('Sign & Submit', { exact: true })).toBeVisible();

    const submitBtn = page.getByRole('button', { name: 'Sign & Submit Report' });
    await expect(submitBtn).toBeDisabled();

    await signCanvas(page);
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect(page.getByText('Incident Report Filed')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Injury / Illness · Test Site · Jamie Worker')).toBeVisible();
  });
});
