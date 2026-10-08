import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas, openForm } from './helpers.js';

// vercel.json ships a Content Security Policy whose connect-src has no data:.
// Chromium treats fetch("data:...") as a connect-src request, so reading the
// signature canvas back with fetch(dataUrl) was refused in production and a
// near miss, incident or sign-afterwards document could not be signed. The
// dev server sends no CSP, so the ordinary suites never saw it. This spec
// applies the real connect-src directive to the page and checks the signature
// upload actually starts.
function productionConnectSrc() {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const rule of vercel.headers || []) {
    for (const h of rule.headers || []) {
      if (h.key === 'Content-Security-Policy') {
        const part = h.value.split(';').map(s => s.trim()).find(s => s.startsWith('connect-src'));
        if (part) return part;
      }
    }
  }
  throw new Error('No connect-src in the vercel.json Content Security Policy');
}

test('a near miss signature uploads under the production connect-src', async ({ page }) => {
  const connectSrc = productionConnectSrc();
  expect(connectSrc).not.toMatch(/\bdata:/);

  await mockWorkerApis(page);
  await mockExternalServices(page);

  const uploadRequests = [];
  await page.route('**/api/reports', async route => {
    const body = route.request().postDataJSON() || {};
    if (body.action === 'create_upload_url') {
      uploadRequests.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: 'near/sig.png', uploadToken: 'tok', receipt: 'receipt-1' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-record-id' }) });
  });

  // Add the production directive to the app document, as Vercel does.
  await page.route('**/', async route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': connectSrc } });
  });

  await loginAsWorker(page);
  await openForm(page, 'Near Miss Report');
  await page.getByPlaceholder('Reporter name').fill('Jamie Worker');
  await page.locator('select').selectOption('Test Site');
  await page.getByPlaceholder('e.g. Excavator and a ground worker').fill('Excavator and a ground worker');
  await page.getByRole('button', { name: 'Continue →' }).click();
  await page.locator('textarea').fill('Excavator swung without a spotter nearby and nearly struck a worker.');
  await page.getByRole('button', { name: 'Generate Report' }).click();
  await expect(page.getByText('Near Miss Incident Report')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to Sign →' }).click();
  await signCanvas(page);
  await page.getByRole('button', { name: 'Sign & Submit Report' }).click();
  await expect(page.getByText('Near Miss Reported')).toBeVisible({ timeout: 15000 });

  const signatureUploads = uploadRequests.filter(r => r.bucket === 'signatures');
  expect(signatureUploads.length).toBeGreaterThan(0);
});
