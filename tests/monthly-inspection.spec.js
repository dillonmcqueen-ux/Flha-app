import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas } from './helpers.js';

test.describe('Monthly Site Inspection', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await page.getByText('Monthly Site Inspection').click();
  });

  test('answers every question, generates a summary, and submits signed', async ({ page }) => {
    await expect(page.getByText('Select site')).toBeVisible();
    await page.locator('select').selectOption('Test Site');
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText('Monthly Site Safety Inspection')).toBeVisible();
    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Inspector');

    // Answer the first question Yes, the second No — the note field should
    // become required for the flagged item.
    const q1 = page.getByText('Are all fire extinguishers accessible and charged?').locator('..');
    await q1.getByRole('button', { name: 'Yes' }).click();
    const q2 = page.getByText('Are all emergency exits clear?').locator('..');
    await q2.getByRole('button', { name: 'No' }).click();

    const generateBtn = page.getByRole('button', { name: 'Generate Summary' });
    await expect(generateBtn).toBeDisabled();
    await page.getByPlaceholder("What's the issue? This becomes a corrective action.").fill('Boxes stacked in front of the east exit.');
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    await expect(page.getByText('1 item flagged')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to Sign →' }).click();

    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Inspection' }).click();

    await expect(page.getByText('Inspection Submitted')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('1 corrective action logged')).toBeVisible();
  });
});
