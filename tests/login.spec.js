import { test, expect } from '@playwright/test';

test('login page loads and asks for a company code', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('FORA');
  await expect(page.getByText('Enter your company code.')).toBeVisible();
  await expect(page.getByPlaceholder('Company code')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Continue/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Founder access/ })).toBeVisible();
});

test('a wrong company code shows an error and lists nothing', async ({ page }) => {
  await page.route('**/api/login', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'find_company') {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: "That company code wasn't recognized. Check it with your supervisor." }) });
    }
    return route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await page.getByPlaceholder('Company code').fill('NOPE123');
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(page.getByText(/wasn't recognized/)).toBeVisible();
  await expect(page.getByPlaceholder('Start typing your name…')).toHaveCount(0);
});

test('a locked-out person gets the Account Owner unlock link option', async ({ page }) => {
  let unlockCalls = 0;
  await page.route('**/api/login', async route => {
    const body = route.request().postDataJSON();
    const json = (status, payload) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (body.action === 'find_company') return json(200, { companyTicket: 't', companyName: 'Test Co' });
    if (body.action === 'list_roster_names') return json(200, { names: [{ id: 1, name: 'Olive Owner' }], companyName: 'Test Co' });
    if (body.action === 'roster_login') return json(403, { error: 'Too many incorrect attempts. Try again in 15 minutes, or ask your supervisor or Account Owner to unlock you.', locked: true });
    if (body.action === 'request_unlock_link') { unlockCalls += 1; return json(200, { ok: true }); }
    return json(400, {});
  });
  await page.goto('/');
  await page.getByPlaceholder('Company code').fill('TESTCODE');
  await page.getByRole('button', { name: /^Continue/ }).click();
  await page.getByPlaceholder('Start typing your name…').fill('Oli');
  await page.getByRole('button', { name: 'Olive Owner' }).click();
  await page.locator('input[type="tel"]').fill('123456');
  await expect(page.getByText(/Too many incorrect attempts/)).toBeVisible();
  await page.getByRole('button', { name: /Email me an unlock link/ }).click();
  await expect(page.getByText(/unlock link is on its way/)).toBeVisible();
  expect(unlockCalls).toBe(1);
});

test('founder access is behind its own button', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Founder access/ }).click();
  await expect(page.getByPlaceholder('Admin code')).toBeVisible();
});
