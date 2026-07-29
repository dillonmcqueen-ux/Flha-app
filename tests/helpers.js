import { expect } from '@playwright/test';

// Stubs every backend call a worker-facing form makes so these tests run
// fully offline and deterministically, independent of Supabase/Anthropic
// availability or real company data.
export async function mockWorkerApis(page, { companyId = 'test-company-id', companyName = 'Test Co' } = {}) {
  await page.route('**/api/login', async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: { role: body.role, companyId, companyName, userName: '' },
        token: 'test-token',
      }),
    });
  });

  await page.route('**/api/customforms', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ builtinActive: {}, customForms: [] }),
    });
  });

  await page.route('**/api/companydata', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'list_sites') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sites: [{ id: 'site-1', name: 'Test Site' }] }),
      });
    }
    if (body.action === 'list_custom_fields') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fields: [] }) });
    }
    // get_company_logo and anything else
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ logo_url: '' }) });
  });

  // Covers both the Near Miss and Incident "structure my description"
  // requests — the response includes every field either form reads.
  await page.route('**/api/generate-flha', async route => {
    const report = {
      severity: 'Medium',
      severityReason: 'Could have caused a moderate injury.',
      whatHappened: 'A worker nearly stepped into the path of moving equipment.',
      contributingFactors: ['No spotter present', 'Limited visibility'],
      potentialOutcome: 'Could have resulted in a struck-by injury.',
      immediateActions: ['Work paused and area re-briefed'],
      nextSteps: ['Assign a spotter for this task going forward'],
      summary: 'A worker sustained a minor injury while carrying material.',
      sequenceOfEvents: ['Worker began carrying material', 'Lost footing on uneven ground', 'Fell and struck forearm'],
      rootCause: 'Uneven ground was not identified before work began.',
      correctiveActions: ['Inspect walking surfaces before starting work'],
    };
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ text: JSON.stringify(report) }] }),
    });
  });

  await page.route('**/api/reports', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-record-id' }) });
  });
}

// The real submit flow loads jsPDF from a CDN and uploads the PDF/signature
// to Supabase Storage. Both are external services this sandbox can't reach,
// and neither is what these tests are checking — so stub them with the
// minimal surface the generators call, letting the actual form/save logic
// run for real.
export async function mockExternalServices(page) {
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/jspdf/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.jspdf = {
          jsPDF: function () {
            const handler = {
              get(target, prop) {
                if (prop === 'splitTextToSize') return (t) => [String(t || '')];
                if (prop === 'output') return () => new Blob(['pdf'], { type: 'application/pdf' });
                if (prop === 'internal') return { getNumberOfPages: () => 1 };
                if (prop === 'then') return undefined;
                return () => proxy;
              },
            };
            const proxy = new Proxy({}, handler);
            return proxy;
          },
        };
      `,
    });
  });

  await page.route('**/storage/v1/object/**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'mock/path.png' }) });
  });
}

export async function loginAsWorker(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Worker/ }).click();
  await page.getByPlaceholder('Company code').fill('TESTCODE');
  await page.getByRole('button', { name: 'Continue →' }).click();
  await expect(page.getByText('Choose a form')).toBeVisible();
}

export async function signCanvas(page) {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 15, { steps: 5 });
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
}
