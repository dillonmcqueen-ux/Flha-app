import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas } from './helpers.js';

test.describe('Toolbox Talk', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await page.getByText('Toolbox Talk').click();
  });

  test('supports the "After Incident" meeting type and walks through to a saved talk', async ({ page }) => {
    await page.getByPlaceholder('Who is leading the talk?').fill('Jamie Presenter');

    // Regression check for the meeting type we added alongside Daily/Weekly/Monthly.
    await page.getByRole('button', { name: 'After Incident' }).click();
    await page.locator('select').selectOption('Test Site');
    await page.getByRole('button', { name: 'Continue →' }).click();

    await expect(page.getByText("What's the talk about?")).toBeVisible();
    await page.locator('textarea').fill('Reviewing what happened during last week\'s near miss involving the excavator.');
    await page.getByRole('button', { name: 'Generate Talking Points' }).click();

    await expect(page.getByText('After Incident Toolbox Talk')).toBeVisible();
    await expect(page.getByText('Excavation hazards')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to Sign-Off →' }).click();

    await expect(page.getByText('Attendance & Sign-Off')).toBeVisible();
    await signCanvas(page);
    await page.getByRole('button', { name: '✓ Presenter Sign' }).click();

    const finishBtn = page.getByRole('button', { name: /Finish & Save/ });
    await expect(finishBtn).toBeVisible();
    await finishBtn.click();

    await expect(page.getByText('Toolbox Talk Recorded')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('After Incident · Test Site')).toBeVisible();
  });
});
