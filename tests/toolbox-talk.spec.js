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
    await expect(page.getByText('Running a new talk, or signing one you missed?')).toBeVisible();
    await page.getByRole('button', { name: 'Start a New Toolbox Talk' }).click();

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

  test('lets someone who missed a talk find it and sign it later', async ({ page }) => {
    await page.getByRole('button', { name: 'I Missed One — Sign It Now' }).click();

    await expect(page.getByText('Recent Toolbox Talks')).toBeVisible();
    const talkRow = page.getByText('Daily · Test Site');
    await expect(talkRow).toBeVisible();
    await expect(page.getByText(/Jamie Presenter/)).toBeVisible();
    await talkRow.click();

    await expect(page.getByText('Daily Toolbox Talk')).toBeVisible();
    await expect(page.getByText('Covering fall protection basics for the crew.')).toBeVisible();

    const submitBtn = page.getByRole('button', { name: 'Sign & Submit' });
    await expect(submitBtn).toBeDisabled();
    await page.getByPlaceholder('Your full name').fill('Alex Missed');
    await signCanvas(page);
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect(page.getByText('Signature Recorded')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Daily · Test Site · Signed by Alex Missed')).toBeVisible();
  });
});
