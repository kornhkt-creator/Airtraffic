import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { AIRPORT } from './airport/layout';
import { angleDiff } from './math';
import type { Aircraft, Command } from './types';

const R01L = AIRPORT.arrivalRunway;
const R01R = AIRPORT.departureRunway;
const SOUTH = -Math.PI / 2;
const EAST = 0;
const NORTH = Math.PI / 2;

function quietSim(seed = 61): Simulation {
  const sim = new Simulation({ seed, autoSpawn: false });
  sim.start();
  sim.aircraft = [];
  return sim;
}

function arrival(sim: Simulation): Aircraft {
  const a = sim.spawnArrival({ inbound: false });
  if (!a) throw new Error('holding stack full');
  return a;
}

function ok(sim: Simulation, cmd: Command): string {
  const r = sim.issueCommand(cmd);
  if (!r.ok) throw new Error(`${cmd.type} rejected: ${r.message}`);
  return r.message;
}

function runUntil(sim: Simulation, predicate: () => boolean, maxSeconds = 900): void {
  const maxTicks = Math.ceil(maxSeconds / sim.clock.dt);
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    sim.step();
  }
  throw new Error(`condition not reached within ${maxSeconds}s of sim time`);
}

/** Records every pose flown until touchdown. */
function flyToTouchdown(sim: Simulation, ac: Aircraft): { x: number; y: number; heading: number }[] {
  const track: { x: number; y: number; heading: number }[] = [];
  runUntil(sim, () => {
    track.push({ ...ac.position, heading: ac.heading });
    return ac.status === 'LANDED';
  });
  return track;
}

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) < tol;
const heading = (h: number, target: number): boolean => Math.abs(angleDiff(h, target)) < 0.05;

describe('Arrival route after a landing clearance', () => {
  for (const runway of [R01L, R01R]) {
    it(`flies downwind south, base east, then final north onto ${runway.designators[0]}`, () => {
      const sim = quietSim();
      const ac = arrival(sim);
      ok(sim, { type: 'LAND', aircraftId: ac.id, runwayId: runway.id });
      const track = flyToTouchdown(sim, ac);
      const { downwindX, baseY } = AIRPORT.approach;

      const downwind = track.findIndex((p) => near(p.x, downwindX, 2) && heading(p.heading, SOUTH));
      const base = track.findIndex((p) => near(p.y, baseY, 2) && heading(p.heading, EAST));
      const final = track.findIndex((p) => near(p.x, runway.touchdown.x, 2) && heading(p.heading, NORTH) && p.y > baseY + 100);
      expect(downwind, 'downwind leg flown').toBeGreaterThanOrEqual(0);
      expect(base, 'base leg flown after downwind').toBeGreaterThan(downwind);
      expect(final, 'final flown after base').toBeGreaterThan(base);

      expect(ac.position.x).toBeCloseTo(runway.touchdown.x, 0);
      expect(ac.prev.altitude).toBeLessThan(3);
      expect(ac.runwayId).toBe(runway.id);
    });
  }
});

describe('Runway choice', () => {
  it('offers both runways to an arrival and rejects unknown ones', () => {
    const sim = quietSim();
    const ac = arrival(sim);
    const land = sim.snapshot().aircraft[0]!.commands.find((c) => c.type === 'LAND')!;
    expect(land.destinations?.map((d) => [d.label, d.enabled])).toEqual([
      [`RWY ${R01L.designators[0]}`, true],
      [`RWY ${R01R.designators[0]}`, true],
    ]);
    const r = sim.issueCommand({ type: 'LAND', aircraftId: ac.id, runwayId: '99X' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Unknown runway');
  });

  it('lands on 01R, vacates onto taxiway B and taxis to a gate', () => {
    const sim = quietSim();
    const ac = arrival(sim);
    expect(ok(sim, { type: 'LAND', aircraftId: ac.id, runwayId: R01R.id })).toContain(R01R.designators[0]);
    runUntil(sim, () => ac.status === 'LANDED' && !ac.onRunway);
    expect(R01R.exits.map((e) => e.exitNodeId)).toContain(ac.exitNodeId);
    ok(sim, { type: 'TAXI', aircraftId: ac.id, destinationId: sim.freeGates()[0]! });
    runUntil(sim, () => ac.status === 'AT_GATE');
    expect(sim.crash).toBeNull();
    expect(sim.scoring.completedArrivals).toBe(1);
  });

  it('shares 01R between landings and takeoffs one at a time', () => {
    const sim = quietSim();
    const ac = arrival(sim);
    const dep = sim.spawnDeparture('G16')!;
    dep.status = 'HOLDING';
    dep.gateId = null;
    dep.holdingPointId = 'H1';
    const h1 = sim.routes.node('H1').position;
    dep.position = { ...h1 };
    dep.heading = EAST;

    // Landing on 01R blocks departures from lining up...
    ok(sim, { type: 'LAND', aircraftId: ac.id, runwayId: R01R.id });
    const lineUp = sim.issueCommand({ type: 'LINE_UP', aircraftId: dep.id });
    expect(lineUp.ok).toBe(false);
    expect(lineUp.message).toContain(ac.callsign);
    expect(sim.snapshot().runways.find((r) => r.use === 'MIXED')!.occupiedBy).toEqual([ac.callsign]);
    // ...while 01L stays free for other arrivals.
    expect(sim.snapshot().runways.find((r) => r.use === 'ARRIVALS')!.occupiedBy).toHaveLength(0);

    runUntil(sim, () => ac.status === 'LANDED' && !ac.onRunway);
    ok(sim, { type: 'LINE_UP', aircraftId: dep.id });

    // A departure on 01R blocks a landing clearance for 01R, but not for 01L.
    const next = arrival(sim);
    expect(next.holdingLevel).toBe(0);
    expect(dep.onRunway).toBe(true);
    const r = sim.issueCommand({ type: 'LAND', aircraftId: next.id, runwayId: R01R.id });
    expect(r.ok).toBe(false);
    expect(r.message).toContain(dep.callsign);
    ok(sim, { type: 'LAND', aircraftId: next.id, runwayId: R01L.id });
    expect(next.runwayId).toBe(R01L.id);
    expect(sim.crash).toBeNull();
  });
});
