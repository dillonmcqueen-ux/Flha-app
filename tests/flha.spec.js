import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas, openForm } from './helpers.js';

test.describe('FLHA (Field Level Hazard Assessment)', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await openForm(page, 'FLHA');
  });

  test('walks setup through AI-generated hazards to a signed submission', async ({ page }) => {
    await expect(page.getByText('Site & Worker Info')).toBeVisible();
    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Worker');
    await page.locator('select').selectOption('Test Site');
    await page.getByRole('button', { name: /^Continue to Voice Input/ }).click();

    await expect(page.getByText('Describe Your Task')).toBeVisible();
    await page.locator('textarea').fill('Operating an excavator near an active roadway, digging a trench for a water line.');
    await page.getByRole('button', { name: /Generate FLHA/ }).click();

    await expect(page.getByText('Job Hazard Analysis')).toBeVisible();
    await expect(page.getByText('Struck-by hazard from moving equipment')).toBeVisible();
    await expect(page.getByText('Hard hat')).toBeVisible();

    await page.getByRole('button', { name: /^Continue to Sign-Off/ }).click();
    await expect(page.getByText('Worker Sign-Off')).toBeVisible();

    const submitBtn = page.getByRole('button', { name: /Sign & Submit FLHA/ });
    await expect(submitBtn).toBeDisabled();
    await signCanvas(page);
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect(page.getByText('FLHA Complete')).toBeVisible({ timeout: 15000 });
    // The happy path says nothing about a missing PDF.
    await expect(page.getByText('This FLHA saved without its PDF.')).toBeHidden();
  });

  test('warns on the success screen when the server saved the FLHA but not its PDF', async ({ page }) => {
    // pdfLinked: false is how api/flhas.js reports that a PDF was submitted
    // but its upload receipt no longer verified (realistically: an offline
    // submission draining after SESSION_SECRET was rotated — receipts carry
    // no expiry). The record is saved; only its PDF link is missing. Before
    // this, that outcome reached a server log and nothing else.
    await page.route('**/api/flhas', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'submit') {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ id: 'test-flha-id', status: 'complete', pdfLinked: false }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-flha-id' }) });
    });

    await page.getByPlaceholder('e.g. John Smith').fill('Jamie Worker');
    await page.locator('select').selectOption('Test Site');
    await page.getByRole('button', { name: /^Continue to Voice Input/ }).click();
    await page.locator('textarea').fill('Operating an excavator near an active roadway, digging a trench for a water line.');
    await page.getByRole('button', { name: /Generate FLHA/ }).click();
    await expect(page.getByText('Job Hazard Analysis')).toBeVisible();

    await page.getByRole('button', { name: /^Continue to Sign-Off/ }).click();
    await signCanvas(page);
    await page.getByRole('button', { name: /Sign & Submit FLHA/ }).click();

    await expect(page.getByText('FLHA Complete')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('This FLHA saved without its PDF.')).toBeVisible();
    // The warning has to say the work is safe, not just that something broke.
    await expect(page.getByText(/every hazard and signature is recorded/)).toBeVisible();
  });
});
