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
// `builtinActive` is what get_worker_documents answers (a key set to false
// is a module the company does not have); `clockOpenSince` starts the worker
// already clocked in. `calls` records every companydata action, in order.
export async function mockWorkerApis(page, { companyId = 'test-company-id', companyName = 'Test Co', userId = null, builtinActive = {}, clockOpenSince: initialClockOpenSince = null } = {}) {
  const calls = [];
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
      body: JSON.stringify({ builtinActive, customForms: [] }),
    });
  });

  let clockOpenSince = initialClockOpenSince;
  await page.route('**/api/companydata', async route => {
    const body = route.request().postDataJSON();
    calls.push(body.action);
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

  return { calls };
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
                // Real jsPDF methods like getTextWidth() return a number that
                // callers do arithmetic on (e.g. "doc.getTextWidth(x) + 8").
                // Without this, Symbol.toPrimitive falls through to the
                // catch-all below, which returns a function — and a
                // Symbol.toPrimitive method that doesn't return a primitive
                // throws "Cannot convert object to primitive value" the
                // moment any code tries to use the result as a number/string.
                if (prop === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');
                if (prop === 'getTextWidth') return () => 10;
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
  // src/Login.jsx renders `Continue <ChevronRight />` — the arrow is a lucide
  // icon component, not the literal "→" this used to match. Matching on the
  // word alone survives the next icon swap.
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(page.getByText('Safety', { exact: true })).toBeVisible();
}

// src/WorkerMenu.jsx groups the built-in forms under three category cards
// (CATEGORIES there) instead of the old flat "Choose a form" list, so getting
// to a form is now two clicks. Time Clock is deliberately uncategorised and
// sits on the home screen itself, hence the null.
const FORM_CATEGORY = {
  'FLHA': 'Safety',
  'Toolbox Talk': 'Safety',
  'Near Miss Report': 'Safety',
  'Incident Report': 'Safety',
  'My Certifications': 'Safety',
  'Equipment Inspection': 'Equipment',
  'Log Fuel': 'Equipment',
  'Daily Report': 'General',
  'Monthly Site Inspection': 'General',
  'Time Clock': null,
};

export async function openForm(page, title) {
  const category = FORM_CATEGORY[title];
  if (category === undefined) throw new Error(`openForm: no category mapped for "${title}" — add it to FORM_CATEGORY in tests/helpers.js`);
  if (category) await page.getByText(category, { exact: true }).click();
  await page.getByText(title, { exact: true }).click();
}

export async function signCanvas(page) {
  const canvas = page.locator('canvas').first();
  // Raw page.mouse coordinates are viewport-relative and don't auto-scroll
  // the way locator.click() does — on a long form (e.g. a full equipment
  // checklist) the canvas can start out below the fold, so scroll it into
  // view first or the drag lands on nothing and the signature never registers.
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 15, { steps: 5 });
  await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
}

// ── Supervisor dashboard ──────────────────────────────────────────────────
// src/Dashboard.jsx pulls from a dozen endpoints on load. This stubs all of
// them so the dashboard renders offline, and hands back a mutable `state`
// the test can change mid-session to stand in for "a worker submitted
// something while you were looking at this screen".
//
// `documents` is what get_document_settings answers, e.g.
// [{ key: 'timeclock', isActive: false }] for a company without Time Clock.
// `timeReports`, `timeEntries` and `myOpenShift` seed the Time Clock tab;
// `state.calls` records every companydata action, in order.
export function mockSupervisorApis(page, {
  companyId = 'test-company-id', companyName = 'Test Co', userId = null,
  documents = [], timeReports = [], timeEntries = [], timeRoster = [], myOpenShift = null,
} = {}) {
  const state = { flhas: [], companyId, companyName, calls: [], myOpenShift };

  const json = (route, payload) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(payload),
  });

  page.route('**/api/login', async route => {
    const body = route.request().postDataJSON();
    await json(route, {
      session: { role: body.role, companyId, companyName, userName: 'Sam Supervisor', userId },
      token: 'test-token',
    });
  });

  page.route('**/api/companydata', async route => {
    const { action } = route.request().postDataJSON();
    state.calls.push(action);
    if (action === 'list_companies_brief') return json(route, { companies: [{ id: companyId, name: companyName, roster_enabled: false }] });
    if (action === 'list_sops') return json(route, { sops: [] });
    if (action === 'list_sites') return json(route, { sites: [] });
    if (action === 'list_time_entries') return json(route, { roster: timeRoster, entries: timeEntries, weekStart: '2026-01-01', weekEnd: '2026-01-07' });
    if (action === 'list_time_reports') return json(route, { reports: timeReports });
    if (action === 'my_time_status') return json(route, { open: state.myOpenShift, recent: [] });
    if (action === 'clock_out') { state.myOpenShift = null; return json(route, { ok: true }); }
    if (action === 'list_roster') return json(route, { members: [] });
    return json(route, {});
  });

  page.route('**/api/flhas', async route => json(route, { flhas: state.flhas }));
  page.route('**/api/reports', async route => json(route, { records: [] }));
  page.route('**/api/logs', async route => json(route, { records: [] }));
  page.route('**/api/monthly', async route => json(route, { records: [], actions: [] }));
  page.route('**/api/customforms', async route => {
    const { action } = route.request().postDataJSON();
    if (action === 'get_worker_documents') return json(route, { builtinActive: {}, customForms: [] });
    if (action === 'get_document_settings') return json(route, { documents });
    return json(route, { records: [] });
  });
  page.route('**/api/certifications', async route => {
    const { action } = route.request().postDataJSON();
    if (action === 'list_employee_directory') return json(route, { employees: [] });
    return json(route, { expiredCount: 0, expiringSoonCount: 0, expired: [], expiringSoon: [] });
  });
  page.route('**/api/maintenance', async route => json(route, { equipment: [] }));
  page.route('**/api/fuellogs', async route => json(route, { records: [] }));
  page.route('**/api/equipmentreports', async route => json(route, { reports: [] }));

  return state;
}

export function flhaFixture({ id = 'flha-new', workerName = 'Jamie Worker', site = 'Test Site', companyId = 'test-company-id' } = {}) {
  return {
    id, company_id: companyId, worker_name: workerName, job_site: site,
    created_at: new Date().toISOString(), status: 'complete', pdf_url: null,
    hazards_json: { taskSummary: 'Trenching near a roadway.', hazards: [] },
  };
}

export async function loginAsSupervisor(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Supervisor \/ Safety/ }).click();
  await page.getByPlaceholder('Company code').fill('TESTCODE');
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(page.getByText(/Welcome back/)).toBeVisible();
}
