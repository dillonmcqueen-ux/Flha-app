import { test, expect } from '@playwright/test';

// Break #24. The invite screen offered "Add a ticket" to a new hire at a
// company without Certification Tracking; the server refused only after
// they had filled it in. redeem_wallet_invite now says whether the module
// is on, and the card follows it. The server-side answer is pinned in
// tests/unit/wallet-invite-modules.test.js; this pins what the screen does
// with it.

function mockInvite(page, certificationsEnabled) {
  const calls = [];
  page.route('**/api/login', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      session: { role: 'worker', companyId: 7, companyName: 'Test Co', userId: 1, userName: 'New Hire' },
      token: 'test-token', email: '', certificationsEnabled,
    }),
  }));
  page.route('**/api/certifications', route => {
    calls.push(route.request().postDataJSON().action);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ certifications: [] }) });
  });
  return calls;
}

test('a company WITHOUT Certification Tracking: no ticket card, and the rest of the invite still works', async ({ page }) => {
  const calls = mockInvite(page, false);
  await page.goto('/wallet?token=abc');
  await expect(page.getByText('Choose your PIN')).toBeVisible();
  await expect(page.getByText('Add a ticket')).toHaveCount(0);
  await expect(page.getByText(/No tickets yet/)).toHaveCount(0);
  expect(calls).not.toContain('list_certifications');
});

test('a company WITH it keeps the ticket card', async ({ page }) => {
  mockInvite(page, true);
  await page.goto('/wallet?token=abc');
  await expect(page.getByText('Add a ticket')).toBeVisible();
});

test('when the server could not check, the card still shows', async ({ page }) => {
  mockInvite(page, null);
  await page.goto('/wallet?token=abc');
  await expect(page.getByText('Add a ticket')).toBeVisible();
});
