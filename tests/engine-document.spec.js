import { test, expect } from '@playwright/test';
import { mockWorkerApis, mockExternalServices, loginAsWorker, signCanvas } from './helpers.js';

// A unified-engine document, filled in on a phone-sized screen and submitted.

const DOC = {
  definition: { id: 5, key: 'yard_check', title: 'Yard Check', icon: null, category: 'safety' },
  versionId: 11,
  fields: [
    { field_key: 'safe', label: 'Is the yard safe?', field_type: 'yesno', required: true, config: {} },
    { field_key: 'brakes', label: 'Brakes', field_type: 'condition3', required: false, config: {} },
    { field_key: 'ppe', label: 'PPE worn', field_type: 'ppe_list', required: false, config: {} },
  ],
  layout: {},
  reference: [],
  signatureSteps: [{ signer: 'worker' }],
};

async function mockEngine(page, doc = DOC) {
  const calls = [];
  await page.route('**/api/documents', async (route) => {
    const b = route.request().postDataJSON();
    calls.push(b);
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (b.action === 'list_worker_documents') return json({ documents: [{ id: 5, key: 'yard_check', title: 'Yard Check', icon: null, category: 'safety' }] });
    if (b.action === 'get_document') return json(doc);
    if (b.action === 'get_picker_options') return json({ options: b.kind === 'equipment' ? [{ id: 1, label: 'Unit 12 - 2019 Cat 320' }] : [{ id: 7, label: 'North Yard' }] });
    if (b.action === 'create_upload_url') return json({ ok: true, path: `x/${b.kind}`, uploadToken: 'tok', receipt: `rcpt-${b.kind}` });
    if (b.action === 'submit') return json({ ok: true, id: 77, status: 'submitted' });
    return json({}, 400);
  });
  await page.route('**/storage/v1/object/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'k' }) }));
  return calls;
}

test.describe('Engine document form', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('lists, fills, signs and submits', async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    const calls = await mockEngine(page);
    await loginAsWorker(page);

    await page.getByText('Yard Check').click();
    await expect(page.getByText('Is the yard safe?')).toBeVisible();

    // Required answer and signature are enforced before anything is sent.
    await page.getByRole('button', { name: /Sign and submit/ }).click();
    await expect(page.getByRole('alert')).toContainText('Is the yard safe?');
    expect(calls.some((c) => c.action === 'submit')).toBe(false);

    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await page.getByRole('button', { name: 'Defective' }).click();
    await page.getByRole('button', { name: /Sign and submit/ }).click();
    await expect(page.getByRole('alert')).toContainText('Brakes');
    await page.getByLabel('Brakes note').fill('Left brake sticks');
    await page.getByRole('button', { name: /Hard hat/ }).click();
    await page.locator('#eng-site').selectOption('Test Site');

    await page.getByRole('button', { name: /Sign and submit/ }).click();
    await expect(page.getByRole('alert')).toContainText('Sign the document');
    await signCanvas(page);
    await page.getByRole('button', { name: /Sign and submit/ }).click();

    await expect(page.getByText('Submitted')).toBeVisible({ timeout: 15000 });
    const sub = calls.find((c) => c.action === 'submit');
    expect(sub.definitionId).toBe(5);
    expect(sub.answers).toMatchObject({ safe: 'yes', brakes: 'Defective', ppe: ['Hard hat'] });
    expect(sub.notes.brakes).toBe('Left brake sticks');
    expect(sub.signature).toBe('rcpt-signature');
    expect(sub.clientSubmissionId).toBeTruthy();
  });

  test('saves to the offline queue when there is no signal', async ({ page, context }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    const calls = await mockEngine(page);
    await loginAsWorker(page);
    await page.getByText('Yard Check').click();
    await expect(page.getByText('Is the yard safe?')).toBeVisible();
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await signCanvas(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: /Sign and submit/ }).click();
    await expect(page.getByText('Saved, no signal')).toBeVisible({ timeout: 15000 });
    expect(calls.some((c) => c.action === 'submit')).toBe(false);
  });

  test('equipment and site pickers send ids', async ({ page }) => {
    await mockWorkerApis(page);
    await mockExternalServices(page);
    const doc = { ...DOC, signatureSteps: [], fields: [
      { field_key: 'machine', label: 'Machine used', field_type: 'equipment_picker', required: true, config: {} },
      { field_key: 'where', label: 'Work area', field_type: 'site_picker', required: false, config: {} },
    ] };
    const calls = await mockEngine(page, doc);
    await loginAsWorker(page);
    await page.getByText('Yard Check').click();
    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect(page.getByRole('alert')).toContainText('Machine used');
    await page.getByLabel('Machine used').selectOption('1');
    await page.getByLabel('Work area').selectOption('7');
    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect(page.getByText('Submitted')).toBeVisible({ timeout: 15000 });
    const sub = calls.find((c) => c.action === 'submit');
    expect(sub.answers.machine).toEqual({ equipmentId: 1 });
    expect(sub.answers.where).toEqual({ siteId: 7 });
  });
});
