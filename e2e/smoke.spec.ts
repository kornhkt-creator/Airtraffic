import { expect, test, type Page } from '@playwright/test';
import type { SimSnapshot } from '../src/sim/snapshot';

/** Reads the live simulation through the dev-only debug hook. */
async function snapshot(page: Page): Promise<SimSnapshot> {
  return page.evaluate(() => {
    if (!window.__sim) throw new Error('debug hook missing (is this the dev server?)');
    return window.__sim.snapshot();
  });
}

/**
 * Selects a flight from the flight list. On tablets and phones the list is a drawer that has to be
 * opened first; it closes again once a flight is picked.
 */
async function selectFlight(page: Page, callsign: string): Promise<void> {
  const toggle = page.locator('.flights-toggle');
  if (await toggle.isVisible()) await toggle.click();
  await page.locator('.flight-row').filter({ hasText: callsign }).click();
  await expect(page.locator('.right-panel')).toContainText(callsign);
  await expect(page.locator('.right-panel')).toBeInViewport();
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
    await expect(page.locator('.flight-row')).not.toHaveCount(0);
    // Nothing on the page is wider than the screen (no sideways scrolling on phones).
    const overflow = await page.evaluate(() => document.querySelector('.app')!.getBoundingClientRect().width - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Arrival: select it in the list and clear it to land with the real command button.
    const arrival = (await snapshot(page)).aircraft.find((a) => a.flightType === 'ARRIVAL' && a.status === 'APPROACH');
    expect(arrival, 'an arrival is holding at start').toBeTruthy();
    await selectFlight(page, arrival!.callsign);
    // LAND offers one button per runway; pick 01R.
    await page.getByRole('button', { name: 'RWY 01R' }).click();
    await expect.poll(() => statusOf(page, arrival!.callsign)).toBe('LANDING');
    await expect(page.locator('.right-panel')).toContainText('Cleared to land RWY 01R');
    // The slot now offers a go-around instead.
    await expect(page.getByRole('button', { name: /Go around/ })).toBeEnabled();

    // Departure: approve pushback from the UI.
    const departure = (await snapshot(page)).aircraft.find((a) => a.flightType === 'DEPARTURE' && a.status === 'AT_GATE');
    expect(departure, 'a departure is waiting at a gate').toBeTruthy();
    await selectFlight(page, departure!.callsign);
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
