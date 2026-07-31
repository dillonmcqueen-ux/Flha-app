import { expect } from '@playwright/test';

// One superset "AI response" used for every form's generate-* call. Extra
// keys are harmless — each form only reads the ones it knows about — so a
// single fixture covers FLHA, Inspection, Near Miss, Incident, Toolbox
// Talk, Daily Report, and Monthly Inspection instead of sniffing prompts.
const AI_RESPONSE = {
  // FLHA (App.jsx)
  taskSummary: 'Worker will operate an excavator near an active roadway.',
  hazards: [
    { hazard: 'Struck-by hazard from moving equipment', risk: 'High', control: 'Maintain a spotter and exclusion zone', sopRef: null },
    { hazard: 'Manual handling strain', risk: 'Medium', control: 'Use proper lifting technique', sopRef: null },
  ],
  sopAlerts: [],
  ppeRequired: ['Hard hat', 'Safety vest'],
  additionalNotes: null,
  // Near Miss / Incident
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
  // Equipment Inspection
  machineSummary: 'Mid-size excavator — pre-use hydraulic and structural check.',
  items: [
    { item: 'Check hydraulic hoses for leaks', category: 'Hydraulics' },
    { item: 'Inspect tracks for wear or damage', category: 'Undercarriage' },
  ],
  // Toolbox Talk
  sections: [
    { heading: 'Excavation hazards', bullets: ['Watch for cave-in risk', 'Call before you dig'] },
  ],
  discussion: ['Has anyone had a close call while digging?'],
  // Daily Report
  workSummary: 'Crew completed footing excavation on the north side and poured two piers.',
  delaysSummary: 'No delays or issues reported.',
  tomorrowPlan: 'Strip forms and begin south footings.',
};

// Stubs every backend call a worker-facing form makes so these tests run
// fully offline and deterministically, independent of Supabase/Anthropic
// availability or real company data.
export async function mockWorkerApis(page, { companyId = 'test-company-id', companyName = 'Test Co', userId = null } = {}) {
  await page.route('**/api/login', async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        session: { role: body.role, companyId, companyName, userName: '', userId },
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

  let clockOpenSince = null;
  await page.route('**/api/companydata', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'list_sites') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sites: [{ id: 'site-1', name: 'Test Site' }] }),
      });
    }
    if (body.action === 'list_equipment') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ equipment: [{ id: 'eq-1', year: '2019', make: 'Caterpillar', model: '320', type: 'Excavator', unit_number: '12' }] }),
      });
    }
    if (body.action === 'list_custom_fields') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fields: [] }) });
    }
    if (body.action === 'list_sops') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ sops: [{ policy_text: 'All workers must conduct a hazard assessment before starting work.' }] }),
      });
    }
    if (body.action === 'my_time_status') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ open: clockOpenSince ? { clock_in: clockOpenSince } : null, recent: [] }),
      });
    }
    if (body.action === 'clock_in') {
      clockOpenSince = new Date().toISOString();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    if (body.action === 'clock_out') {
      clockOpenSince = null;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    // get_company_logo, add_site, add_equipment, and anything else
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ logo_url: '' }) });
  });

  // Covers every form's "structure my description" request.
  await page.route('**/api/generate-flha', async route => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ text: JSON.stringify(AI_RESPONSE) }] }),
    });
  });

  await page.route('**/api/reports', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-record-id' }) });
  });

  await page.route('**/api/flhas', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-flha-id' }) });
  });

  await page.route('**/api/logs', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'check_equipment') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ openPretrip: null, lastInspection: null }) });
    }
    if (body.action === 'list_open_toolbox') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          talks: [{
            id: 'talk-1', presenter_name: 'Jamie Presenter', meeting_type: 'Daily', site: 'Test Site',
            topic: 'Fall protection', created_at: new Date().toISOString(), signedCount: 1,
          }],
        }),
      });
    }
    if (body.action === 'get_toolbox_detail') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          record: {
            id: 'talk-1', presenter_name: 'Jamie Presenter', meeting_type: 'Daily', site: 'Test Site',
            topic: 'Fall protection', created_at: new Date().toISOString(), pdf_url: null,
            talking_points_json: { summary: 'Covering fall protection basics for the crew.', sections: [], discussion: [], customFields: [] },
            attendees_json: [{ name: 'Jamie Presenter', signature: 'data:image/png;base64,x', presenter: true }],
          },
          company: { name: 'Test Co', logo_url: '' },
        }),
      });
    }
    if (body.action === 'sign_late_toolbox') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-log-id' }) });
  });

  await page.route('**/api/monthly', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'get_active_form') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          form: { id: 'form-1', title: 'Monthly Site Safety Inspection' },
          questions: [
            { id: 'q1', question_text: 'Are all fire extinguishers accessible and charged?' },
            { id: 'q2', question_text: 'Are all emergency exits clear?' },
          ],
          existingRecord: null,
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
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
