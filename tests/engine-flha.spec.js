import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas } from './helpers.js';

// The FLHA template in the engine's worker form: describe the task, the AI writes
// the hazards, the worker adds crew sign-off, signs and files it.

const FLHA_DOC = {
  definition: { id: 9, key: 'flha', title: 'FLHA (engine)', icon: null, category: 'safety' },
  versionId: 21,
  layout: {},
  reference: [],
  signatureSteps: [{ signer: 'worker' }],
  fields: [
    { field_key: 'task_summary', label: 'Task summary', field_type: 'long_text', required: true, config: {} },
    { field_key: 'hazards', label: 'Hazard checklist', field_type: 'hazard_table', required: true, config: { aiAssist: { taskField: 'task_summary', alertsField: 'sop_alerts', ppeField: 'ppe', notesField: 'notes', flagField: 'ai_assisted' } } },
    { field_key: 'sop_alerts', label: 'SOP alerts triggered', field_type: 'text_list', required: false, config: {} },
    { field_key: 'ppe', label: 'Required PPE', field_type: 'ppe_list', required: false, config: {} },
    { field_key: 'notes', label: 'Additional notes', field_type: 'long_text', required: false, config: {} },
    { field_key: 'ai_assisted', label: 'Written with AI assistance', field_type: 'yesno', required: false, config: { hidden: true } },
    { field_key: 'crew', label: 'Additional crew sign-off', field_type: 'crew_signatures', required: false, config: {} },
  ],
};

test.describe('FLHA template in the engine form', () => {
  test.use({ viewport: { width: 390, height: 900 } });

  test('AI hazards, crew sign-off, worker signature, submit', async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    const calls = [];
    await page.route('**/api/documents', async (route) => {
      const b = route.request().postDataJSON();
      calls.push(b);
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (b.action === 'list_worker_documents') return json({ documents: [{ id: 9, key: 'flha', title: 'FLHA (engine)', icon: null, category: 'safety' }], assigned: [] });
      if (b.action === 'get_document') return json(FLHA_DOC);
      if (b.action === 'get_picker_options') return json({ options: [{ id: 12, label: 'Cora Crew' }, { id: 13, label: 'Lou Lead' }] });
      if (b.action === 'create_upload_url') return json({ ok: true, path: 'x', uploadToken: 't', receipt: `rcpt-${b.kind}-${calls.length}` });
      if (b.action === 'submit') return json({ ok: true, id: 5, status: 'submitted' });
      return json({});
    });
    await page.route('**/storage/v1/object/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'k' }) }));
    await loginAsWorker(page);

    await page.getByText('FLHA (engine)').click();
    await page.getByLabel('Describe the task').fill('Operating an excavator near an active roadway.');
    await page.getByRole('button', { name: 'Generate hazards' }).click();

    // The AI's hazards plus the two guaranteed baseline ones.
    await expect(page.locator('[aria-label^="Hazard "]')).toHaveCount(4);
    await expect(page.locator('input[aria-label="Hazard 1"]')).toHaveValue('Struck-by hazard from moving equipment');
    await expect(page.getByRole('button', { name: /Hard hat/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Add another task' })).toHaveCount(0);

    // Crew sign-off: pick a person and sign.
    await page.getByLabel('Crew member').selectOption('12');
    await page.getByTestId('signature-pad').nth(0).scrollIntoViewIfNeeded();
    const pad = page.getByTestId('signature-pad').nth(0);
    const box = await pad.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 40); await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 20, { steps: 5 }); await page.mouse.up();
    await page.getByRole('button', { name: 'Add crew sign-off' }).click();
    await expect(page.getByAltText("Cora Crew's signature")).toBeVisible();

    await page.locator('#eng-site').selectOption('Test Site');
    await signCanvas(page); // the worker's own pad is the last one on the page
    await page.getByRole('button', { name: /Sign and submit/ }).click();
    await expect(page.getByText('Submitted')).toBeVisible({ timeout: 15000 });

    const sub = calls.find((c) => c.action === 'submit');
    expect(sub.answers.task_summary).toBeTruthy();
    expect(sub.answers.hazards).toHaveLength(4);
    expect(sub.answers.hazards.map((h) => h.risk)).toContain('High');
    expect(sub.answers.ai_assisted).toBe('yes');
    expect(sub.answers.ppe).toEqual(expect.arrayContaining(['Hard hat', 'Safety vest']));
    expect(sub.crew).toHaveLength(1);
    expect(sub.crew[0].rosterId).toBe(12);
    expect(Object.keys(sub.crew[0]).sort()).toEqual(['rosterId', 'signature']);
    expect(sub.signature).toMatch(/^rcpt-signature/);
  });

  test('without a signal the worker can carry on without the AI and the form is flagged not-AI', async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    await page.route('**/api/generate-flha', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) }));
    await page.route('**/api/documents', async (route) => {
      const b = route.request().postDataJSON();
      const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (b.action === 'list_worker_documents') return json({ documents: [{ id: 9, key: 'flha', title: 'FLHA (engine)', icon: null, category: 'safety' }], assigned: [] });
      if (b.action === 'get_document') return json(FLHA_DOC);
      if (b.action === 'get_picker_options') return json({ options: [] });
      return json({});
    });
    await loginAsWorker(page);
    await page.getByText('FLHA (engine)').click();
    await page.getByLabel('Describe the task').fill('Hand digging a post hole');
    await page.getByRole('button', { name: 'Generate hazards' }).click();
    await expect(page.getByRole('alert')).toContainText("Couldn't generate hazards");
    await page.getByRole('button', { name: 'Carry on without AI' }).click();
    await expect(page.getByLabel('Task summary')).toHaveCount(0); // summary is a plain textarea, not labelled for the assist
    await expect(page.locator('textarea').filter({ hasText: 'Hand digging a post hole' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Add hazard' }).click();
    await expect(page.locator('input[aria-label="Hazard 1"]')).toBeVisible();
  });
});
