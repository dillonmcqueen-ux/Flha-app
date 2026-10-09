import { test, expect } from '@playwright/test';
import { mockSupervisorApis, mockWorkerApis, mockExternalServices, loginAsSupervisor, loginAsWorker, signCanvas } from './helpers.js';

const DOCS = [{ id: 5, key: 'yard_check', title: 'Yard Check', icon: null, category: 'safety' }];

async function mockEngineApi(page, handlers) {
  const calls = [];
  await page.route('**/api/documents', async (route) => {
    const b = route.request().postDataJSON();
    calls.push(b);
    const out = handlers(b);
    if (out && out.__status) return route.fulfill({ status: out.__status, contentType: 'application/json', body: JSON.stringify({ error: out.error }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out || {}) });
  });
  await page.route('**/storage/v1/object/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'k' }) }));
  return calls;
}

test.describe('Engine document inbox', () => {
  test('a supervisor sees the badge, reads a document and approves it', async ({ page }) => {
    mockSupervisorApis(page);
    let waiting = true;
    const calls = await mockEngineApi(page, (b) => {
      if (b.action === 'list_worker_documents') return { documents: DOCS };
      if (b.action === 'my_inbox') return { mine: [], review: waiting ? [{ kind: 'review', recordId: 9, definitionId: 5, step: 'Supervisor review', at: '2026-10-09T10:00:00Z' }] : [], counts: { mine: 0, review: waiting ? 1 : 0, total: waiting ? 1 : 0 } };
      if (b.action === 'list_escalations') return { escalations: [] };
      if (b.action === 'get_record') return {
        record: { id: 9, definition_id: 5, status: 'pending_approval', submitted_at: '2026-10-09T10:00:00Z', awaiting_signature: false },
        answers: [{ id: 1, question_text: 'Is the yard safe?', field_type: 'yesno', value_text: 'no', notes: 'Wet ground' }],
        signatures: [{ id: 1, kind: 'worker', signer_name: 'Jamie Worker', signed_at: '2026-10-09T10:00:00Z' }],
      };
      if (b.action === 'get_record_links') return { pdf: 'https://example.test/signed.pdf', files: {}, signatures: { 1: 'https://example.test/sig.png' } };
      if (b.action === 'review') { waiting = false; return { ok: true }; }
      return {};
    });
    await loginAsSupervisor(page);
    await page.getByRole('button', { name: /Company Docs/ }).click();
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.getByText('Is the yard safe?')).toBeVisible();
    await expect(page.getByText('Note: Wet ground')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'https://example.test/signed.pdf');
    await expect(page.getByRole('link', { name: 'View signature' })).toBeVisible();

    await page.getByRole('button', { name: 'Send back' }).click();
    await expect(page.getByRole('alert')).toContainText('Say what needs fixing');
    expect(calls.some((c) => c.action === 'review')).toBe(false);

    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Nothing is waiting for your review.')).toBeVisible();
    expect(calls.find((c) => c.action === 'review')).toMatchObject({ recordId: 9, decision: 'approve' });
  });

  test('a worker sees a sent-back document, fixes it and sends it again', async ({ page }) => {
    await mockWorkerApis(page, { userId: 12 });
    await mockExternalServices(page);
    const calls = await mockEngineApi(page, (b) => {
      if (b.action === 'list_worker_documents') return { documents: DOCS };
      if (b.action === 'my_inbox') return { mine: [{ kind: 'returned', recordId: 9, definitionId: 5, reason: 'Wrong answer', at: '2026-10-09T10:00:00Z' }], review: [], counts: { mine: 1, review: 0, total: 1 } };
      if (b.action === 'get_record') return {
        record: { id: 9, definition_id: 5, version_id: 11, status: 'returned', returned_reason: 'Wrong answer', site_id: null },
        answers: [{ field_key: 'safe', value_text: 'no', field_type: 'yesno', question_text: 'Is the yard safe?' }, { field_key: 'pic', file_path: 'co/p.png', field_type: 'photo', question_text: 'Photo' }],
        signatures: [],
      };
      if (b.action === 'get_document') return {
        definition: { id: 5, title: 'Yard Check' }, versionId: 11, layout: {}, signatureSteps: [],
        fields: [{ field_key: 'safe', label: 'Is the yard safe?', field_type: 'yesno', required: true, config: {} }, { field_key: 'pic', label: 'Photo', field_type: 'photo', required: true, config: {} }],
      };
      if (b.action === 'create_upload_url') return { ok: true, path: 'x', uploadToken: 't', receipt: `rcpt-${b.kind}` };
      if (b.action === 'resubmit') return { ok: true, status: 'pending_approval' };
      return {};
    });
    await loginAsWorker(page);
    await page.getByText('Company documents need you').click();
    await expect(page.getByText('Sent back: Wrong answer')).toBeVisible();
    await page.getByRole('button', { name: /Fix and resend/ }).click();
    await expect(page.getByRole('note')).toContainText('Wrong answer');
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await page.getByRole('button', { name: /Send back for review/ }).click();
    await expect(page.getByText('Submitted')).toBeVisible({ timeout: 15000 });
    const re = calls.find((c) => c.action === 'resubmit');
    expect(re).toMatchObject({ recordId: 9 });
    expect(re.answers.safe).toBe('yes');
    expect(re.answers.pic).toBeUndefined();
  });
});
