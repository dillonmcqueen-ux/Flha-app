import { test, expect } from '@playwright/test';

// Break #24. The setup screen offered "Add a ticket" to a new hire at a
// company without Certification Tracking; the server refused only after
// they had filled it in. pin_link_set_pin now says whether the module
// is on, and the card follows it. The server-side answer is pinned in
// tests/unit/wallet-invite-modules.test.js; this pins what the screen does
// with it. The screen now starts at "choose your PIN" and only shows the
// ticket card once the PIN is saved and a session exists.

function mockInvite(page, certificationsEnabled) {
  const calls = [];
  page.route('**/api/login', route => {
    const { action } = route.request().postDataJSON();
    if (action === 'pin_link_open') {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ name: 'New Hire', companyName: 'Test Co', emailOnFile: true, emailHint: 'n***@x.com', mfaRequired: false, hasAuthenticator: false }),
      });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        stage: 'session',
        session: { role: 'worker', companyId: 7, companyName: 'Test Co', userId: 1, userName: 'New Hire' },
        token: 'test-token', certificationsEnabled,
      }),
    });
  });
  page.route('**/api/certifications', route => {
    calls.push(route.request().postDataJSON().action);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ certifications: [] }) });
  });
  return calls;
}

async function choosePin(page) {
  await page.goto('/wallet?token=abc');
  await expect(page.getByText('Your PIN', { exact: true })).toBeVisible();
  await page.getByPlaceholder('6 digits').first().fill('482913');
  await page.getByPlaceholder('6 digits').last().fill('482913');
  await page.getByRole('button', { name: 'Set my PIN' }).click();
}

test('a company WITHOUT Certification Tracking: no ticket card, and the rest of the invite still works', async ({ page }) => {
  const calls = mockInvite(page, false);
  await choosePin(page);
  await expect(page.getByText("You're in, New")).toBeVisible();
  await expect(page.getByText('Add a ticket')).toHaveCount(0);
  await expect(page.getByText(/No tickets yet/)).toHaveCount(0);
  expect(calls).not.toContain('list_certifications');
});

test('a company WITH it keeps the ticket card', async ({ page }) => {
  mockInvite(page, true);
  await choosePin(page);
  await expect(page.getByText('Add a ticket')).toBeVisible();
});

test('when the server could not check, the card still shows', async ({ page }) => {
  mockInvite(page, null);
  await choosePin(page);
  await expect(page.getByText('Add a ticket')).toBeVisible();
});

test('mismatched PINs are caught on the page, before anything is sent', async ({ page }) => {
  mockInvite(page, true);
  await page.goto('/wallet?token=abc');
  await page.getByPlaceholder('6 digits').first().fill('482913');
  await page.getByPlaceholder('6 digits').last().fill('111111');
  await page.getByRole('button', { name: 'Set my PIN' }).click();
  await expect(page.getByText("The two PINs don't match.")).toBeVisible();
});

test('someone who needs an authenticator is sent to the login page setup, with no session', async ({ page }) => {
  page.route('**/api/login', route => {
    const { action } = route.request().postDataJSON();
    const body = action === 'pin_link_open'
      ? { name: 'Sup Visor', companyName: 'Test Co', emailOnFile: true, emailHint: 's***@x.com', mfaRequired: true, hasAuthenticator: false }
      : { stage: 'enroll', enrollTicket: 'ticket.sig' };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/wallet?token=abc');
  await expect(page.getByText(/authenticator app/)).toBeVisible();
  await page.getByPlaceholder('6 digits').first().fill('482913');
  await page.getByPlaceholder('6 digits').last().fill('482913');
  await Promise.all([
    page.waitForURL(/mfa_setup=ticket\.sig/),
    page.getByRole('button', { name: 'Set my PIN' }).click(),
  ]);
});
