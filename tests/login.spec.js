import { test, expect } from '@playwright/test';

test('login page loads and offers company search', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('FORA');
  await expect(page.getByText('Search for your company by name.')).toBeVisible();
  await expect(page.getByPlaceholder('Company name')).toBeVisible();
  await expect(page.getByText('Type at least 3 letters.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Founder access/ })).toBeVisible();
});

test('company search needs 3 letters and lists matches', async ({ page }) => {
  let searches = 0;
  await page.route('**/api/login', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'search_companies') {
      searches += 1;
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ companies: [{ name: 'ABC Earthworks Company', companyTicket: 't' }] }),
      });
    }
    return route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');

  await page.getByPlaceholder('Company name').fill('AB');
  await expect(page.getByText('Type at least 3 letters.')).toBeVisible();
  expect(searches).toBe(0);

  await page.getByPlaceholder('Company name').fill('ABC');
  await expect(page.getByRole('button', { name: /ABC Earthworks Company/ })).toBeVisible();
});

test('founder access is behind its own button', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Founder access/ }).click();
  await expect(page.getByPlaceholder('Admin code')).toBeVisible();
});
