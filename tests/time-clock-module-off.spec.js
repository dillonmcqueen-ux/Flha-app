import { test, expect } from '@playwright/test';
import { mockWorkerApis, loginAsWorker, mockSupervisorApis, loginAsSupervisor } from './helpers.js';

// Break #27. Break #23 left clock_out and the time-clock reads open on the
// server on purpose, so a company that drops Time Clock can still close a
// shift that was open and still read the hours it recorded. Both promises
// only held in the API: the worker's Time Clock card and the supervisor's
// Time Clock tab were hidden with the module, and they were the only way in.

// Both screens take a GPS fix before they punch; headless Chromium has none
// without this (see tests/time-clock.spec.js).
test.use({ geolocation: { latitude: 52.4683, longitude: -113.7375 }, permissions: ['geolocation'] });

const OFF = { timeclock: false };
const REPORT = { id: 'rep-1', week_start: '2026-09-07', week_end: '2026-09-13', pdf_url: null, generated_by: 'auto', created_at: '2026-09-14T06:00:00.000Z' };

test.describe('Time Clock after the module is dropped: worker', () => {
  test('a worker still clocked in gets a way to clock out, and nothing else', async ({ page }) => {
    const { calls } = await mockWorkerApis(page, {
      userId: 'roster-user-1', builtinActive: OFF,
      clockOpenSince: new Date(Date.now() - 3 * 3600000).toISOString(),
    });
    await loginAsWorker(page);

    await page.getByRole('button', { name: /Time Clock/ }).click();
    await expect(page.getByText(/Clocked in since/)).toBeVisible();
    await page.getByRole('button', { name: 'Clock Out' }).click();

    await expect(page.getByText("You're not clocked in.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clock In' })).toHaveCount(0);
    await expect(page.getByText(/isn't part of your company's plan/)).toBeVisible();
    expect(calls).toContain('clock_out');
    expect(calls).not.toContain('clock_in');
  });

  test('once the shift is closed, the card goes away', async ({ page }) => {
    await mockWorkerApis(page, {
      userId: 'roster-user-1', builtinActive: OFF,
      clockOpenSince: new Date(Date.now() - 3600000).toISOString(),
    });
    await loginAsWorker(page);
    await page.getByRole('button', { name: /Time Clock/ }).click();
    await page.getByRole('button', { name: 'Clock Out' }).click();
    await expect(page.getByText("You're not clocked in.")).toBeVisible();
    await page.getByRole('button', { name: /Menu/ }).click();

    await expect(page.getByText('Safety', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Time Clock/ })).toHaveCount(0);
  });

  test('a worker with no open shift sees no Time Clock at all', async ({ page }) => {
    await mockWorkerApis(page, { userId: 'roster-user-1', builtinActive: OFF });
    await loginAsWorker(page);
    // Wait for the open-shift check to have answered before asserting absence.
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: /Time Clock/ })).toHaveCount(0);
  });
});

test.describe('Time Clock after the module is dropped: supervisor', () => {
  test('recorded hours stay readable, with every write control gone', async ({ page }) => {
    const state = mockSupervisorApis(page, {
      documents: [{ key: 'timeclock', label: 'Time Clock', isCustom: false, isActive: false }],
      timeReports: [REPORT],
    });
    await loginAsSupervisor(page);

    await page.getByRole('button', { name: 'Time Clock', exact: true }).click();
    await expect(page.getByText('2026-09-07 to 2026-09-13')).toBeVisible();
    await expect(page.getByText(/isn't part of your company's plan/)).toBeVisible();

    for (const name of [/Generate This Week/, /Manual Pull/, /Add Entry/, 'Edit', 'Delete', 'Clock In']) {
      await expect(page.getByRole('button', { name })).toHaveCount(0);
    }
    expect(state.calls).not.toContain('generate_time_report_now');
  });

  test('a supervisor still clocked in can clock out, and not back in', async ({ page }) => {
    const state = mockSupervisorApis(page, {
      userId: 'roster-sup-1',
      documents: [{ key: 'timeclock', label: 'Time Clock', isCustom: false, isActive: false }],
      myOpenShift: { id: 'e1', clock_in: new Date(Date.now() - 3600000).toISOString() },
    });
    await loginAsSupervisor(page);

    await page.getByRole('button', { name: 'Time Clock', exact: true }).click();
    await page.getByRole('button', { name: 'Clock Out' }).click();
    await expect(page.getByText("You're not clocked in.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clock In' })).toHaveCount(0);
    expect(state.calls).toContain('clock_out');
  });

  test('a company that never used Time Clock does not get the tab', async ({ page }) => {
    mockSupervisorApis(page, {
      documents: [{ key: 'timeclock', label: 'Time Clock', isCustom: false, isActive: false }],
    });
    await loginAsSupervisor(page);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('button', { name: 'Time Clock', exact: true })).toHaveCount(0);
  });

  test('a company WITH the module keeps every control', async ({ page }) => {
    mockSupervisorApis(page, {
      documents: [{ key: 'timeclock', label: 'Time Clock', isCustom: false, isActive: true }],
      timeReports: [REPORT],
    });
    await loginAsSupervisor(page);
    await page.getByRole('button', { name: 'Time Clock', exact: true }).click();
    await expect(page.getByRole('button', { name: /Generate This Week/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add Entry/ })).toBeVisible();
    await expect(page.getByText(/isn't part of your company's plan/)).toHaveCount(0);
  });

  test('hours from a week that never became a report can be paged back to', async ({ page }) => {
    // Dropped the module mid-week: the cron never turned that week into a
    // report, so the only record is the entries themselves, two weeks back.
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7) - 14);
    monday.setUTCHours(15, 0, 0, 0);
    const older = new Date(monday.getTime() - 7 * 86400000);
    mockSupervisorApis(page, {
      documents: [{ key: 'timeclock', label: 'Time Clock', isCustom: false, isActive: false }],
      timeRoster: [{ id: 'r1', name: 'Rob Operator', role: 'worker', active: true }],
      timeEntries: [
        { id: 'e1', roster_id: 'r1', clock_in: older.toISOString(), clock_out: new Date(older.getTime() + 8 * 3600000).toISOString() },
        { id: 'e2', roster_id: 'r1', clock_in: monday.toISOString(), clock_out: new Date(monday.getTime() + 10 * 3600000).toISOString() },
      ],
    });
    await loginAsSupervisor(page);

    await page.getByRole('button', { name: 'Time Clock', exact: true }).click();
    // Opens on the last week anyone worked, not the empty current one.
    await expect(page.getByText(/Rob Operator .* 10\.0 hrs/)).toBeVisible();

    await page.getByRole('button', { name: /Previous week/ }).click();
    await expect(page.getByText(/Rob Operator .* 8\.0 hrs/)).toBeVisible();

    await page.getByRole('button', { name: /Next week/ }).click();
    await expect(page.getByText(/Rob Operator .* 10\.0 hrs/)).toBeVisible();

    await page.getByRole('button', { name: 'This week', exact: true }).click();
    await expect(page.getByText(/Rob Operator .* 0\.0 hrs/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Next week/ })).toBeDisabled();
  });
});
