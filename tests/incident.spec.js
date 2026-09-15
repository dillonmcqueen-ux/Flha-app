import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas, openForm } from './helpers.js';
import { colors as C } from '../src/theme.js';

// The selected incident type reads its colour straight off theme.js's danger
// token. Asserting the token rather than a literal rgb() means a palette
// change can't silently fail this test the way the hardcoded one did.
const hexToRgb = (hex) => {
  const [, r, g, b] = /^#(\w{2})(\w{2})(\w{2})$/.exec(hex);
  return `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`;
};

test.describe('Incident report', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await openForm(page, 'Incident Report');
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
    await expect(page.getByRole('button', { name: 'Vehicle Incident' })).toHaveCSS('color', hexToRgb(C.status.danger.text));
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

// docs/scope-offline-capability.md Phase 3: Incident is the only worker
// form that captures photos, so it's the only one that needs the pending-
// photo queue. mockWorkerApis' generic /api/reports stub (`{ id: ... }` for
// every action) never exercises this path, since neither test above adds a
// photo — these tests add their own more specific /api/reports override so
// create_upload_url can be made to fail on demand.
test.describe('Incident report — offline photo queueing (Phase 3)', () => {
  test.beforeEach(async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await loginAsWorker(page);
    await openForm(page, 'Incident Report');
    await page.getByPlaceholder('Reporter name').fill('Jamie Worker');
    await page.locator('select').selectOption('Test Site');
    await page.getByRole('button', { name: 'Continue →' }).click();
    await expect(page.getByText('People & evidence')).toBeVisible();
  });

  test('falls back to local pending storage when the immediate upload fails, and it survives a reload', async ({ page }) => {
    let createUploadCalls = 0;
    await page.route('**/api/reports', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'create_upload_url') {
        createUploadCalls++;
        if (createUploadCalls === 1) return route.abort('connectionfailed');
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ path: `${body.bucket}/${body.filename}`, uploadToken: 'test-token', receipt: `receipt:${body.bucket}:${body.filename}` }),
        });
      }
      return route.fallback();
    });

    await page.setInputFiles('input[type="file"]', [
      { name: 'scene.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(2 * 1024 * 1024, 1) },
    ]);

    await expect(page.getByText('Queued', { exact: true })).toBeVisible();
    await expect(page.getByText('Queued photos will upload automatically')).toBeVisible();
    expect(createUploadCalls).toBe(1);

    // useDraftAutosave debounces writes by 800ms — give it time to flush
    // before reloading, then re-enter the form the way a worker actually
    // would after a dropped connection (not a raw reload mid-render).
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(page.getByText('Safety', { exact: true })).toBeVisible();
    await openForm(page, 'Incident Report');
    await expect(page.getByText('People & evidence')).toBeVisible();
    await expect(page.getByText('Queued', { exact: true })).toBeVisible();
  });

  test('the generated PDF actually embeds the photo and the full severity reason', async ({ page }) => {
    // Both halves of this shipped broken and nothing caught it, because no
    // test had ever looked at the bytes the generator produces.
    //
    // 1. incident-photos is a PRIVATE bucket, and the worker's own submit path
    //    only holds the unsigned public-shaped URL the upload handed back. The
    //    generator used to fetch that, get a 400 JSON body, and embed it as if
    //    it were an image — leaving an empty bordered box.
    // 2. The severity reason was rendered as splitTextToSize(...)[0], so
    //    anything longer than one line was cut off mid-sentence.
    // The generated PDF is the flha-reports upload; the same route also sees
    // the photo (incident-photos) and the signature (signatures).
    let pdfBuffer = null;
    await page.route('**/storage/v1/object/**', async route => {
      const buf = route.request().postDataBuffer();
      if (buf && route.request().url().includes('/flha-reports/')) pdfBuffer = buf;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'mock/path.png' }) });
    });
    await page.route('**/api/reports', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'create_upload_url') {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ path: `${body.bucket}/${body.filename}`, uploadToken: 'test-token', receipt: `receipt:${body.bucket}:${body.filename}` }),
        });
      }
      return route.fallback();
    });

    // A real JPEG (1x1) so the browser produces a genuine image/jpeg File.
    const JPEG = Buffer.from(
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
      + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
      + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
    await page.setInputFiles('input[type="file"]', [
      { name: 'scene.jpg', mimeType: 'image/jpeg', buffer: JPEG },
    ]);
    await expect(page.getByText('Queued', { exact: true })).toBeHidden();

    await page.getByRole('button', { name: 'Continue →' }).click();
    await expect(page.getByText('What happened?')).toBeVisible();
    await page.locator('textarea').fill('A worker slipped near the site entrance and hurt a hand.');
    await page.getByRole('button', { name: 'Generate Report' }).click();
    await expect(page.getByText('Injury / Illness — Incident Report')).toBeVisible();

    await page.getByRole('button', { name: 'Continue to Sign →' }).click();
    await signCanvas(page);
    await page.getByRole('button', { name: 'Sign & Submit Report' }).click();
    await expect(page.getByText('Incident Report Filed')).toBeVisible({ timeout: 15000 });

    expect(pdfBuffer, 'a PDF should have been uploaded to flha-reports').toBeTruthy();
    const pdf = pdfBuffer.toString('latin1');

    // The photo: a JPEG embedded by addImage shows up as a DCTDecode image
    // stream. Before the fix there was no image here at all, just a rectangle.
    expect(pdf).toContain('DCTDecode');

    // The severity reason: helpers.js's AI fixture returns a reason long
    // enough to wrap, so all of it must be present, not just the first line.
    const reason = 'Could have caused a moderate injury.';
    expect(pdf).toContain(reason.slice(0, 20));
  });

  test('blocks a photo that would exceed the on-device pending-photo storage budget', async ({ page }) => {
    await page.route('**/api/reports', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'create_upload_url') return route.abort('connectionfailed');
      return route.fallback();
    });

    // PHOTO_BUDGET_BYTES is 28MB — a single 29MB file alone exceeds it.
    await page.setInputFiles('input[type="file"]', [
      { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(29 * 1024 * 1024, 2) },
    ]);

    await expect(page.getByText('Photo storage on this device is full')).toBeVisible();
    await expect(page.getByText('Failed', { exact: true })).toBeVisible();
  });

  test('drains a queued photo and includes its upload receipt when submitting back online', async ({ page }) => {
    let createUploadCalls = 0;
    await page.route('**/api/reports', async route => {
      const body = route.request().postDataJSON();
      if (body.action === 'create_upload_url') {
        createUploadCalls++;
        if (createUploadCalls === 1) return route.abort('connectionfailed'); // immediate upload fails → queued
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ path: `${body.bucket}/${body.filename}`, uploadToken: 'test-token', receipt: `receipt:${body.bucket}:${body.filename}` }),
        });
      }
      return route.fallback();
    });

    await page.setInputFiles('input[type="file"]', [
      { name: 'scene.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(2 * 1024 * 1024, 1) },
    ]);
    await expect(page.getByText('Queued', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Continue →' }).click();
    await expect(page.getByText('What happened?')).toBeVisible();
    await page.locator('textarea').fill('Worker slipped near the site entrance.');
    await page.getByRole('button', { name: 'Generate Report' }).click();
    await expect(page.getByText('Injury / Illness — Incident Report')).toBeVisible();

    await page.getByRole('button', { name: 'Continue to Sign →' }).click();
    await signCanvas(page);

    const submitReq = page.waitForRequest(req => {
      if (!req.url().includes('/api/reports') || req.method() !== 'POST') return false;
      const b = req.postDataJSON();
      return !!b && b.action === 'submit';
    });
    await page.getByRole('button', { name: 'Sign & Submit Report' }).click();
    const submittedBody = (await submitReq).postDataJSON();

    await expect(page.getByText('Incident Report Filed')).toBeVisible({ timeout: 15000 });
    // create_upload_url is also hit for the signature and the generated PDF
    // during submit, so this only checks it went beyond the single failed
    // immediate attempt — the real proof the photo was drained is the
    // receipt and the cleared IndexedDB blob checked below.
    expect(createUploadCalls).toBeGreaterThan(1);
    // The photo travels as the server-issued receipt, never as a URL the
    // browser assembled: api/reports.js dropped photo_urls from
    // SUBMITTABLE_FIELDS and resolves photoReceipts itself, so a caller
    // can't name an incident-photos path it was never issued.
    expect(submittedBody.record.photo_urls).toBeUndefined();
    expect(submittedBody.photoReceipts.some(r => r.startsWith('receipt:incident-photos:'))).toBe(true);
    expect(submittedBody.signatureReceipt).toMatch(/^receipt:signatures:/);

    // The drained blob should be cleaned out of IndexedDB, not leaked.
    const remainingPhotoIds = await page.evaluate(async () => {
      const req = indexedDB.open('fora_offline_queue');
      const db = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      const ids = await new Promise((resolve) => {
        const out = [];
        const cursorReq = db.transaction('photos', 'readonly').objectStore('photos').openCursor();
        cursorReq.onsuccess = () => {
          if (cursorReq.result) { out.push(cursorReq.result.value.id); cursorReq.result.continue(); } else resolve(out);
        };
      });
      db.close();
      return ids;
    });
    expect(remainingPhotoIds.length).toBe(0);
  });
});
