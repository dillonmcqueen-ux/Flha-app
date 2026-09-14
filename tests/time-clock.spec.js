import { test, expect } from '@playwright/test';
import { mockWorkerApis, loginAsWorker, openForm } from './helpers.js';

test.describe('Time Clock', () => {
  // src/TimeClock.jsx takes a GPS punch via src/punchLocation.js before it
  // calls clock_in/clock_out. Headless Chromium has no geolocation provider,
  // so getPunchLocation() fell through two 12s timeouts and the test timed out
  // before the request was ever made. A fixed position exercises the real
  // path instead of the failure path.
  test.use({ geolocation: { latitude: 52.4683, longitude: -113.7375 }, permissions: ['geolocation'] });

  test.beforeEach(async ({ page }) => {
    // Time Clock only appears for individually-identified roster logins,
    // which carry a real userId — the shared-code login this suite mocks
    // elsewhere doesn't, so it's opted in here explicitly.
    await mockWorkerApis(page, { userId: 'roster-user-1' });
    await loginAsWorker(page);
    await openForm(page, 'Time Clock');
  });

  test('clocks in, shows an elapsed timer, and clocks back out', async ({ page }) => {
    await expect(page.getByText("You're not clocked in.")).toBeVisible();
    const toggleBtn = page.getByRole('button', { name: 'Clock In' });
    await toggleBtn.click();

    await expect(page.getByText(/Clocked in since/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clock Out' })).toBeVisible();

    // Timer should be counting up in HH:MM:SS format.
    const timer = page.locator('text=/^\\d{2}:\\d{2}:\\d{2}$/');
    await expect(timer).toBeVisible();

    await page.getByRole('button', { name: 'Clock Out' }).click();
    await expect(page.getByText("You're not clocked in.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clock In' })).toBeVisible();
  });
});
