import { test, expect } from '@playwright/test';

test('login page loads and role selection works', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('FORA');
  await expect(page.getByText('Select your role to continue')).toBeVisible();

  const workerButton = page.getByRole('button', { name: /Worker/ });
  const supervisorButton = page.getByRole('button', { name: /Supervisor \/ Safety/ });
  await expect(workerButton).toBeVisible();
  await expect(supervisorButton).toBeVisible();

  await workerButton.click();
  await expect(page.getByPlaceholder('Company code')).toBeVisible();
});
