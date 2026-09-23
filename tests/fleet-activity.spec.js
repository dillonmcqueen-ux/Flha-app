import { test, expect } from '@playwright/test';
import { mockSupervisorApis, loginAsSupervisor } from './helpers.js';

// Breaks #13 and #18 on screen. The server halves are pinned in
// tests/unit/fleet-activity.test.js and tests/unit/timeclock-gate.test.js.

const LOADER = { id: 3, make: 'CAT', model: '950', type: 'Loader', unit_number: '3', is_attachment: false };
const FORKS = { id: 12, make: '', model: '', type: 'Pallet Forks', unit_number: '12', is_attachment: true };
const TRAILER = { id: 40, make: '', model: '', type: 'Dump Trailer', unit_number: '40', is_attachment: true };

test('Fleet Overview shows last day on site, and what an attachment was last mounted on', async ({ page }) => {
  mockSupervisorApis(page, {
    equipment: [LOADER, FORKS],
    fleetActivity: {
      lastOnSite: { 3: { date: '2026-09-18', site: 'North Pit' } },
      mountedOn: { 12: { hostId: 3, hostLabel: 'CAT 950 Loader (Unit 3)', at: '2026-09-15T13:00:00Z' } },
      attachments: { mostUsed: [], mostRepaired: [] },
    },
  });
  await loginAsSupervisor(page);
  await page.getByRole('button', { name: 'Equipment', exact: true }).click();

  await expect(page.getByText('Last on site 2026-09-18 at North Pit')).toBeVisible();
  await expect(page.getByText(/Last mounted on CAT 950 Loader \(Unit 3\)/)).toBeVisible();
});

test('forks get no PM set-up; a trailer gets one in KM towed', async ({ page }) => {
  mockSupervisorApis(page, {
    equipment: [FORKS, TRAILER],
    maintenanceStatus: [
      { id: 12, label: 'Pallet Forks (Unit 12)', pmInterval: null, current: null, status: 'not_tracked', pmAllowed: false, isTowed: false, fieldService: [] },
      { id: 40, label: 'Dump Trailer (Unit 40)', pmInterval: null, current: null, status: 'not_tracked', pmAllowed: true, isTowed: true, fieldService: [] },
    ],
  });
  await loginAsSupervisor(page);
  await page.getByRole('button', { name: 'Equipment', exact: true }).click();
  await page.getByRole('button', { name: 'Maintenance', exact: true }).click();

  await expect(page.getByText("Attachments don't get a maintenance schedule unless they're a trailer.")).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Set Up Tracking' })).toHaveCount(1);
  await page.getByRole('button', { name: '+ Set Up Tracking' }).click();
  await expect(page.getByText(/counts the KM it's towed/)).toBeVisible();
});

test('Equipment Analytics names the most used and most repaired attachments', async ({ page }) => {
  mockSupervisorApis(page, {
    equipment: [FORKS],
    fleetActivity: {
      lastOnSite: {}, mountedOn: {},
      attachments: {
        mostUsed: [{ equipmentId: 12, label: 'Pallet Forks (Unit 12)', trips: 9, repairs: 0 }],
        mostRepaired: [{ equipmentId: 13, label: 'Rock Bucket (Unit 13)', trips: 2, repairs: 4 }],
      },
    },
  });
  await loginAsSupervisor(page);
  await page.getByRole('button', { name: 'Equipment Analytics', exact: true }).click();
  await expect(page.getByText('Most Used Attachments')).toBeVisible();
  await expect(page.getByText(/Pallet Forks/).first()).toBeVisible();
  await expect(page.getByText('Most Repaired Attachments')).toBeVisible();
  await expect(page.getByText(/Rock Bucket/).first()).toBeVisible();
});
