import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { SIM_CONFIG } from './config';
import { difficultyLevel, SpawnSystem } from './SpawnSystem';
import { HOLDING_LEVELS, levelAltitude } from './aircraft/holdingStack';
import { distance } from './math';
import type { Aircraft, Command } from './types';

function quietSim(seed = 21): Simulation {
  const sim = new Simulation({ seed, autoSpawn: false });
  sim.start();
  sim.aircraft = [];
  return sim;
}

function spawnArrival(sim: Simulation, inbound = false): Aircraft {
  const a = sim.spawnArrival({ inbound });
  if (!a) throw new Error('holding stack full');
  return a;
}

function runUntil(sim: Simulation, predicate: () => boolean, maxSeconds = 900): void {
  const maxTicks = Math.ceil(maxSeconds / sim.clock.dt);
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    sim.step();
  }
  throw new Error(`condition not reached within ${maxSeconds}s of sim time`);
}

const runSeconds = (sim: Simulation, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / sim.clock.dt); i++) sim.step();
};

describe('Holding stack', () => {
  it('gives every arrival its own level and refuses a fifth', () => {
    const sim = quietSim();
    const arrivals = HOLDING_LEVELS.map(() => spawnArrival(sim));
    expect(arrivals.map((a) => a.holdingLevel)).toEqual([0, 1, 2, 3]);
    expect(arrivals.map((a) => a.altitude)).toEqual([...HOLDING_LEVELS]);
    expect(sim.spawnArrival({ inbound: true })).toBeNull();
  });

  it('clears only the bottom aircraft, then steps the stack down', () => {
    const sim = quietSim();
    const low = spawnArrival(sim);
    const high = spawnArrival(sim);
    const r = sim.issueCommand({ type: 'LAND', aircraftId: high.id });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('lowest');

    expect(sim.issueCommand({ type: 'LAND', aircraftId: low.id }).ok).toBe(true);
    // The upper aircraft waits until the landing one is well below the stack...
    sim.step();
    expect(high.holdingLevel).toBe(1);
    runUntil(sim, () => low.altitude <= levelAltitude(0) - SIM_CONFIG.air.stackClearance);
    sim.step();
    // ...then descends one level.
    expect(high.holdingLevel).toBe(0);
    runUntil(sim, () => Math.abs(high.altitude - levelAltitude(0)) < 1, 120);
    runUntil(sim, () => low.status === 'LANDED' && !low.onRunway);
    expect(sim.issueCommand({ type: 'LAND', aircraftId: high.id }).ok).toBe(true);
  });
});

describe('Inbound arrivals', () => {
  it('fly from the spawn point into the holding pattern without starting the diversion clock', () => {
    const sim = quietSim();
    const ac = spawnArrival(sim, true);
    expect(ac.nav.kind).toBe('inbound');
    const start = { ...ac.position };
    expect(distance(start, sim.routes.layout.approach.holdingCenter)).toBeCloseTo(SIM_CONFIG.traffic.spawnDistance, 0);
    runUntil(sim, () => ac.nav.kind === 'holding', 300);
    // Only the tick on which it joined the pattern counts.
    expect(ac.waitTime).toBeLessThanOrEqual(sim.clock.dt + 1e-9);
    expect(distance(ac.position, sim.holdingLoop.startSample.position)).toBeLessThan(80);
  });
});

describe('Diversion', () => {
  it('warns, diverts after the holding limit, penalizes once and removes the flight', () => {
    const sim = quietSim();
    const ac = spawnArrival(sim);
    runSeconds(sim, SIM_CONFIG.air.maxHoldingTime - SIM_CONFIG.air.divertWarning + 1);
    expect(ac.divertWarned).toBe(true);
    expect(sim.alerts.some((a) => a.message.includes('low on fuel'))).toBe(true);
    expect(ac.status).toBe('APPROACH');

    runUntil(sim, () => ac.status === 'DIVERTED', 60);
    expect(sim.scoring.score).toBe(-SIM_CONFIG.scoring.diversionPenalty);
    expect(sim.scoring.diversions).toBe(1);
    expect(sim.issueCommand({ type: 'LAND', aircraftId: ac.id }).ok).toBe(false);
    // Keeps its stack level while leaving, so nobody descends into it.
    expect(ac.holdingLevel).toBe(0);
    expect(spawnArrival(sim).holdingLevel).toBe(1);

    runUntil(sim, () => !sim.aircraft.includes(ac), 300);
    expect(sim.scoring.score).toBe(-SIM_CONFIG.scoring.diversionPenalty);
    sim.step();
    expect(sim.aircraft[0]!.holdingLevel).toBe(0);
  });
});

describe('Turnaround', () => {
  it('turns a parked arrival into a departure at the same gate', () => {
    const sim = new Simulation({ seed: 5 });
    sim.start();
    sim.aircraft = [];
    const ac = spawnArrival(sim);
    ac.status = 'AT_GATE';
    ac.gateId = 'G3';
    ac.holdingLevel = null;
    runSeconds(sim, SIM_CONFIG.traffic.turnaroundTime + 1);
    expect(sim.aircraft.includes(ac)).toBe(false);
    const dep = sim.aircraft.find((a) => a.gateId === 'G3');
    expect(dep?.flightType).toBe('DEPARTURE');
    expect(dep?.status).toBe('AT_GATE');
    expect(dep?.callsign).not.toBe(ac.callsign);
  });
});

describe('Difficulty ramp', () => {
  it('raises the level and the traffic caps over time', () => {
    expect(difficultyLevel(0)).toBe(1);
    expect(difficultyLevel(SIM_CONFIG.traffic.rampDuration / 2)).toBe(3);
    expect(difficultyLevel(SIM_CONFIG.traffic.rampDuration)).toBe(5);
    expect(difficultyLevel(99999)).toBe(5);
    const spawner = new SpawnSystem();
    expect(spawner.maxAirborneArrivals(0)).toBe(2);
    expect(spawner.maxAirborneArrivals(99999)).toBe(4);
    expect(spawner.maxActive(0)).toBe(4);
    expect(spawner.maxActive(99999)).toBe(8);
  });
});

/** Some aircraft is moving on the ground (taxiing, being pushed back, or rolling out). */
const groundBusy = (sim: Simulation): boolean =>
  sim.aircraft.some((o) => (o.status === 'TAXIING' && !o.taxiHold) || (o.status === 'PUSHBACK' && o.nav.path !== null) || (o.status === 'LANDED' && o.onRunway));

/**
 * Minimal careful controller, once per second: issues the next sensible command to every aircraft,
 * but starts a ground movement only while nothing else moves on the ground (no head-on conflicts).
 */
function autopilot(sim: Simulation): void {
  for (const a of [...sim.aircraft]) {
    if ((a.status === 'LANDED' || a.status === 'AT_GATE') && groundBusy(sim)) continue;
    const tries: Command[] = [];
    if (a.status === 'APPROACH') tries.push({ type: 'LAND', aircraftId: a.id });
    if (a.status === 'LANDED' && !a.destinationId) for (const g of sim.freeGates()) tries.push({ type: 'TAXI', aircraftId: a.id, destinationId: g });
    if (a.status === 'AT_GATE' && a.flightType === 'DEPARTURE') tries.push({ type: 'PUSHBACK', aircraftId: a.id });
    if (a.status === 'PUSHBACK' && !a.destinationId) for (const hp of ['H1', 'H2']) tries.push({ type: 'TAXI', aircraftId: a.id, destinationId: hp });
    if (a.status === 'HOLDING') tries.push({ type: 'LINE_UP', aircraftId: a.id });
    if (a.status === 'LINE_UP') tries.push({ type: 'TAKEOFF', aircraftId: a.id });
    for (const cmd of tries) if (sim.issueCommand(cmd).ok) break;
  }
}

/** Stack levels are this far apart; airborne traffic closer than this vertically is a violation. */
const MIN_VERTICAL_SEPARATION = HOLDING_LEVELS[1]! - HOLDING_LEVELS[0]! - 10;

describe('Long traffic run', () => {
  const run = (seed: number, withAutopilot: boolean) => {
    const sim = new Simulation({ seed });
    sim.start();
    const ticksPerSecond = Math.round(1 / sim.clock.dt);
    let violations = 0;
    let maxLevelsShared = 0;
    const seenIds = new Set<string>();
    for (let t = 0; t < 20 * 60 * ticksPerSecond; t++) {
      if (withAutopilot && t % ticksPerSecond === 0) autopilot(sim);
      sim.step();
      const airborne = sim.aircraft.filter((a) => a.altitude > 30);
      for (let i = 0; i < airborne.length; i++) {
        for (let j = i + 1; j < airborne.length; j++) {
          const a = airborne[i]!;
          const b = airborne[j]!;
          if (distance(a.position, b.position) < 1500 && Math.abs(a.altitude - b.altitude) < MIN_VERTICAL_SEPARATION) violations++;
        }
      }
      const levels = sim.aircraft.map((a) => a.holdingLevel).filter((l) => l !== null);
      maxLevelsShared = Math.max(maxLevelsShared, levels.length - new Set(levels).size);
      for (const a of sim.aircraft) seenIds.add(a.id);
    }
    return { sim, violations, maxLevelsShared, flights: seenIds.size };
  };

  it('keeps stacked and departing traffic separated while the controller works', () => {
    const { sim, violations, maxLevelsShared, flights } = run(99, true);
    expect(sim.crash).toBeNull();
    expect(maxLevelsShared).toBe(0);
    expect(violations).toBe(0);
    expect(flights).toBeGreaterThanOrEqual(12);
    expect(sim.scoring.completedFlights).toBeGreaterThanOrEqual(6);
    expect(sim.snapshot().difficultyLevel).toBe(5);
  });

  it('diverts unattended arrivals and penalizes each exactly once', () => {
    const { sim, violations, maxLevelsShared } = run(7, false);
    expect(sim.crash).toBeNull();
    expect(maxLevelsShared).toBe(0);
    expect(violations).toBe(0);
    expect(sim.scoring.diversions).toBeGreaterThan(5);
    // Nothing is completed, so the score is exactly the penalties: diversions plus delays of the
    // departures left waiting at their gates.
    expect(sim.scoring.score).toBe(-sim.scoring.penaltyPoints);
    const { diversion, delay } = sim.scoring.penaltyCounts;
    expect(sim.scoring.penaltyPoints).toBe(diversion * SIM_CONFIG.scoring.diversionPenalty + delay * SIM_CONFIG.scoring.delayPenalty);
    // Gates fill with waiting departures, but one is always kept free for arrivals.
    expect(sim.freeGates().length).toBeGreaterThanOrEqual(SIM_CONFIG.traffic.keepFreeGates);
  });

  it('is deterministic for a given seed', () => {
    const a = run(3, true).sim.snapshot();
    const b = run(3, true).sim.snapshot();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
