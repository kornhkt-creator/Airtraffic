import { expect, test, type Page } from '@playwright/test';
import type { SimSnapshot } from '../src/sim/snapshot';

/** Reads the live simulation through the dev-only debug hook. */
async function snapshot(page: Page): Promise<SimSnapshot> {
  return page.evaluate(() => {
    if (!window.__sim) throw new Error('debug hook missing (is this the dev server?)');
    return window.__sim.snapshot();
  });
}

async function statusOf(page: Page, callsign: string): Promise<string | undefined> {
  return (await snapshot(page)).aircraft.find((a) => a.callsign === callsign)?.status;
}

test.describe('smoke', () => {
  test('loads, starts, accepts commands from the UI and ends with a mission summary', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/Airport Traffic Control Simulator 3D/);
    await expect(page.locator('canvas')).toBeVisible();

    // Start screen → running game with traffic in the flight list.
    await page.getByRole('button', { name: 'Start shift' }).click();
    await expect.poll(async () => (await snapshot(page)).status).toBe('RUNNING');
    const rows = page.locator('.flight-row');
    await expect(rows).not.toHaveCount(0);

    // Arrival: select it in the list and clear it to land with the real command button.
    const arrival = (await snapshot(page)).aircraft.find((a) => a.flightType === 'ARRIVAL' && a.status === 'APPROACH');
    expect(arrival, 'an arrival is holding at start').toBeTruthy();
    await rows.filter({ hasText: arrival!.callsign }).click();
    await expect(page.locator('.right-panel')).toContainText(arrival!.callsign);
    await page.getByRole('button', { name: /Clear to land/ }).click();
    await expect.poll(() => statusOf(page, arrival!.callsign)).toBe('LANDING');
    // The slot now offers a go-around instead.
    await expect(page.getByRole('button', { name: /Go around/ })).toBeEnabled();

    // Departure: approve pushback from the UI.
    const departure = (await snapshot(page)).aircraft.find((a) => a.flightType === 'DEPARTURE' && a.status === 'AT_GATE');
    expect(departure, 'a departure is waiting at a gate').toBeTruthy();
    await rows.filter({ hasText: departure!.callsign }).click();
    await page.getByRole('button', { name: /Approve pushback/ }).click();
    await expect.poll(() => statusOf(page, departure!.callsign)).toBe('PUSHBACK');

    // A rejected command explains itself instead of changing anything.
    const rejected = await page.evaluate((id) => window.__sim!.command({ type: 'TAKEOFF', aircraftId: id }), departure!.id);
    expect(rejected.ok).toBe(false);
    expect(await statusOf(page, departure!.callsign)).toBe('PUSHBACK');

    // Ending the shift shows the mission summary.
    await page.getByRole('button', { name: /End shift/ }).click();
    await expect(page.getByRole('heading', { name: 'Mission summary' })).toBeVisible();
    const summary = await snapshot(page);
    expect(summary.status).toBe('GAME_OVER');
    expect(summary.endReason).toBe('shift-ended');

    // Restart resets everything.
    await page.getByRole('button', { name: /Play again/ }).click();
    await expect.poll(async () => (await snapshot(page)).status).toBe('RUNNING');
    expect((await snapshot(page)).summary.penaltyPoints).toBe(0);

    expect(errors).toEqual([]);
  });
});
