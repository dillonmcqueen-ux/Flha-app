import { test, expect } from '@playwright/test';
import { mockSupervisorApis, mockWorkerApis, mockExternalServices, loginAsSupervisor, loginAsWorker } from './helpers.js';

const json = (route, payload) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });

const SENT = [
  { id: 1, title: 'Winter driving', category: 'policies', mode: 'sign', status: 'sent', displayStatus: 'sent', due_at: null, sent_by_name: 'Sam Supervisor', roster_id: 12, sent_by_roster_id: 7, batch_id: 'b1', created_at: '2026-10-20T10:00:00Z' },
  { id: 2, title: 'Yard notice', category: 'notices', mode: 'read', status: 'completed', displayStatus: 'completed', completed_at: '2026-10-21T10:00:00Z', sent_by_name: 'Sam Supervisor', roster_id: 12, sent_by_roster_id: 7, batch_id: 'b2', created_at: '2026-10-19T10:00:00Z' },
];

test.describe('Inbox', () => {
  test('a worker gets one inbox card, with needs action and completed tabs', async ({ page }) => {
    await mockWorkerApis(page, { userId: 12 });
    await mockExternalServices(page);
    await page.route('**/api/certifications', async (route) => {
      const b = route.request().postDataJSON();
      if (b.action === 'list_sent_documents') return json(route, { documents: SENT });
      return json(route, {});
    });
    await loginAsWorker(page);

    // The old stacked lists are gone from the home screen.
    await expect(page.getByText('Sent to you', { exact: true })).toHaveCount(0);
    const card = page.getByRole('button', { name: 'Inbox, 1 need action' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('1 need action · 1 completed');

    await card.click();
    await expect(page.getByRole('tab', { name: 'Needs action (1)' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Winter driving')).toBeVisible();
    await expect(page.getByText('Yard notice')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Completed (1)' }).click();
    await expect(page.getByText('Yard notice')).toBeVisible();
    await expect(page.getByText('Winter driving')).toHaveCount(0);

    // A row opens the document screen, and Back returns to the inbox.
    await page.getByRole('tab', { name: /Needs action/ }).click();
    await page.getByText('Winter driving').click();
    await expect(page.getByRole('button', { name: 'Open the document' })).toBeVisible();
    await page.getByRole('button', { name: /Back/ }).click();
    await expect(page.getByRole('tab', { name: /Needs action/ })).toBeVisible();
  });

  test('a worker with nothing waiting sees no inbox card', async ({ page }) => {
    await mockWorkerApis(page, { userId: 12 });
    await mockExternalServices(page);
    await page.route('**/api/certifications', (route) => json(route, { documents: [] }));
    await loginAsWorker(page);
    await expect(page.getByText('Welcome')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Inbox,/ })).toHaveCount(0);
  });

  test('a supervisor sees unreviewed reports on the Overview inbox', async ({ page }) => {
    mockSupervisorApis(page);
    await page.route('**/api/reports', async (route) => {
      const b = route.request().postDataJSON() || {};
      if (b.type === 'incident') {
        return json(route, { records: [{ id: 'inc-1', company_id: 'test-company-id', site: 'North Pit', reporter_name: 'Jamie Worker', incident_type: 'Injury', occurred_at: '2026-10-21T15:00:00Z', report_json: { severity: 'High', summary: 'Pinched finger' }, reviewed: false }] });
      }
      return json(route, { records: [] });
    });
    await loginAsSupervisor(page);
    const card = page.getByRole('button', { name: 'Inbox, 1 need review' });
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByRole('tab', { name: 'Needs review (1)' })).toBeVisible();
    await expect(page.getByText('Incident: North Pit')).toBeVisible();
  });
});
