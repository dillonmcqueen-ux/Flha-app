import { test, expect } from '@playwright/test';
import { mockSupervisorApis, loginAsSupervisor, flhaFixture } from './helpers.js';

// The dashboard used to load its data exactly once, on mount, so anything
// submitted after a supervisor signed in stayed invisible until they signed
// out and back in. These cover the three ways it re-pulls now.
test.describe('Supervisor dashboard refresh', () => {
  const openFlhaTab = async (page) => {
    await page.getByRole('button', { name: 'FLHAs', exact: true }).click();
    await expect(page.getByText('No FLHAs submitted yet for this company.')).toBeVisible();
    // Rows are collapsed inside a per-site group by default — flatten the
    // list so a new record shows up as plain text.
    await page.getByRole('combobox').nth(2).selectOption('none');
  };

  test('the Refresh button picks up a submission made after sign-in', async ({ page }) => {
    const state = mockSupervisorApis(page);
    await loginAsSupervisor(page);
    await openFlhaTab(page);

    state.flhas = [flhaFixture({ workerName: 'Jamie Worker' })];
    await page.getByRole('button', { name: 'Refresh dashboard data' }).click();

    await expect(page.getByText('Jamie Worker')).toBeVisible();
  });

  test('coming back from the worker forms view re-pulls the lists', async ({ page }) => {
    const state = mockSupervisorApis(page);
    await loginAsSupervisor(page);
    await openFlhaTab(page);

    await page.getByRole('button', { name: /Fill Out a Form/ }).click();
    await expect(page.getByText('Safety', { exact: true })).toBeVisible();

    // Stands in for the form the supervisor just filled out landing in the
    // database while they were on that screen.
    state.flhas = [flhaFixture({ workerName: 'Sam Supervisor' })];
    await page.getByRole('button', { name: /Back to Dashboard/ }).click();

    await expect(page.getByText('Sam Supervisor', { exact: true })).toBeVisible();
  });

  test('returning to a backgrounded tab re-pulls the lists', async ({ page }) => {
    const state = mockSupervisorApis(page);
    await loginAsSupervisor(page);
    await openFlhaTab(page);

    state.flhas = [flhaFixture({ workerName: 'Riley Operator' })];
    // Past the de-dupe window that keeps focus + visibilitychange from
    // firing two identical loads on the same switch-back.
    await page.waitForTimeout(5500);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

    await expect(page.getByText('Riley Operator')).toBeVisible();
  });
});
