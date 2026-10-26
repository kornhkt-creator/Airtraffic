import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { SIM_CONFIG } from './config';
import { HOLDING_LEVELS, levelAltitude, stackAltitude } from './aircraft/holdingStack';
import type { Aircraft, Command } from './types';

const NORTH = Math.PI / 2;
const S = SIM_CONFIG.scoring;

function quietSim(seed = 51): Simulation {
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

function ok(sim: Simulation, cmd: Command): void {
  const r = sim.issueCommand(cmd);
  if (!r.ok) throw new Error(`${cmd.type} rejected: ${r.message}`);
}

function runUntil(sim: Simulation, predicate: () => boolean, maxSeconds = 600): void {
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

describe('GO_AROUND', () => {
  it('aborts a landing, frees the runway, rejoins the hold and can land again', () => {
    const sim = quietSim();
    const ac = arrival(sim);
    runSeconds(sim, 20);
    const holdingUsed = ac.waitTime;
    ok(sim, { type: 'LAND', aircraftId: ac.id });
    runSeconds(sim, 10);
    expect(sim.snapshot().aircraft[0]!.commands[0]!.type).toBe('GO_AROUND');

    ok(sim, { type: 'GO_AROUND', aircraftId: ac.id });
    expect(ac.status).toBe('GO_AROUND');
    expect(ac.nav.kind).toBe('goaround');
    expect(sim.snapshot().runways.find((r) => r.use === 'ARRIVALS')!.occupiedBy).toHaveLength(0);
    expect(sim.scoring.score).toBe(-S.goAroundPenalty);
    expect(sim.scoring.penaltyCounts.goAround).toBe(1);
    // Still had its stack level, so it keeps it.
    expect(ac.holdingLevel).toBe(0);

    runUntil(sim, () => ac.status === 'APPROACH', 300);
    expect(ac.nav.kind).toBe('holding');
    runUntil(sim, () => Math.abs(ac.altitude - levelAltitude(0)) < 1, 60);
    // The holding (fuel) clock was not reset by the landing attempt.
    expect(ac.waitTime).toBeGreaterThanOrEqual(holdingUsed);

    ok(sim, { type: 'LAND', aircraftId: ac.id });
    runUntil(sim, () => ac.status === 'LANDED');
    expect(sim.scoring.penaltyCounts.goAround).toBe(1);
    expect(sim.crash).toBeNull();
  });

  it('is only available while landing', () => {
    const sim = quietSim();
    const ac = arrival(sim);
    expect(sim.issueCommand({ type: 'GO_AROUND', aircraftId: ac.id }).ok).toBe(false);
    ok(sim, { type: 'LAND', aircraftId: ac.id });
    runUntil(sim, () => ac.status === 'LANDED');
    const late = sim.issueCommand({ type: 'GO_AROUND', aircraftId: ac.id });
    expect(late.ok).toBe(false);
    expect(late.message).toContain('LANDING');
    const dep = sim.spawnDeparture('G1')!;
    expect(sim.issueCommand({ type: 'GO_AROUND', aircraftId: dep.id }).ok).toBe(false);
    expect(sim.scoring.penaltyCounts.goAround).toBe(0);
  });

  it('takes a free level when it had already left the stack, or waits above a full stack', () => {
    const sim = quietSim();
    const ac = arrival(sim);
    ok(sim, { type: 'LAND', aircraftId: ac.id });
    // Low on final: the stack level has been released.
    runUntil(sim, () => ac.holdingLevel === null);
    // Meanwhile the stack fills up completely.
    const others = HOLDING_LEVELS.map(() => arrival(sim));
    expect(others.map((a) => a.holdingLevel)).toEqual([0, 1, 2, 3]);

    ok(sim, { type: 'GO_AROUND', aircraftId: ac.id });
    expect(ac.holdingLevel).toBeNull();
    expect(stackAltitude(ac)).toBeGreaterThan(HOLDING_LEVELS[HOLDING_LEVELS.length - 1]!);
    runUntil(sim, () => ac.status === 'APPROACH', 300);

    // When the bottom aircraft is cleared to land, everyone steps down and the go-around gets a level.
    ok(sim, { type: 'LAND', aircraftId: others[0]!.id });
    runUntil(sim, () => ac.holdingLevel !== null, 300);
    expect(ac.holdingLevel).toBe(HOLDING_LEVELS.length - 1);
    expect(sim.crash).toBeNull();
  });
});

describe('Penalties', () => {
  it('charges a delay for every full minute a departure waits for an instruction', () => {
    const sim = quietSim();
    const dep = sim.spawnDeparture('G1')!;
    runSeconds(sim, S.delayThreshold - 1);
    expect(sim.scoring.penaltyCounts.delay).toBe(0);
    runSeconds(sim, 2);
    expect(sim.scoring.penaltyCounts.delay).toBe(1);
    runSeconds(sim, S.delayThreshold);
    expect(sim.scoring.penaltyCounts.delay).toBe(2);
    expect(sim.scoring.score).toBe(-2 * S.delayPenalty);

    // An instruction starts a new wait.
    ok(sim, { type: 'PUSHBACK', aircraftId: dep.id });
    runUntil(sim, () => dep.nav.path === null);
    expect(dep.delayPenalties).toBe(0);
    runSeconds(sim, S.delayThreshold + 1);
    expect(sim.scoring.penaltyCounts.delay).toBe(3);
  });

  it('never charges delays for parked arrivals or holding aircraft', () => {
    const sim = quietSim();
    const arr = arrival(sim);
    const parked = arrival(sim);
    parked.status = 'AT_GATE';
    parked.gateId = 'G1';
    parked.holdingLevel = null;
    runSeconds(sim, SIM_CONFIG.traffic.turnaroundTime - 5);
    expect(arr.status).toBe('APPROACH');
    expect(sim.scoring.penaltyCounts.delay).toBe(0);
  });

  it('charges a runway incursion once', () => {
    const sim = quietSim();
    const stray = sim.spawnDeparture('G1')!;
    stray.status = 'HOLDING';
    stray.gateId = null;
    const rwy = sim.routes.layout.arrivalRunway;
    stray.position = { x: rwy.start.x, y: rwy.start.y + 500 };
    stray.heading = NORTH;
    runSeconds(sim, 5);
    expect(sim.scoring.penaltyCounts.incursion).toBe(1);
    expect(sim.scoring.score).toBe(-S.incursionPenalty);
  });

  it('charges a lost-separation conflict once per pair', () => {
    const sim = quietSim();
    const a = arrival(sim);
    const b = arrival(sim);
    for (const [ac, x] of [[a, -2500], [b, -2200]] as const) {
      ac.position = { x, y: 1500 };
      ac.altitude = 400;
      ac.nav.path = null;
    }
    runSeconds(sim, 3);
    expect(sim.scoring.penaltyCounts.conflict).toBe(1);
    expect(sim.scoring.score).toBe(-S.conflictPenalty);
  });
});

describe('End of game', () => {
  it('ends the shift on request with a mission summary', () => {
    const sim = quietSim();
    const ac = arrival(sim);
    ok(sim, { type: 'LAND', aircraftId: ac.id });
    runUntil(sim, () => ac.status === 'LANDED' && !ac.onRunway);
    ok(sim, { type: 'TAXI', aircraftId: ac.id, destinationId: sim.freeGates()[0]! });
    runUntil(sim, () => ac.status === 'AT_GATE');

    sim.endShift();
    const snap = sim.snapshot();
    expect(snap.status).toBe('GAME_OVER');
    expect(snap.endReason).toBe('shift-ended');
    expect(snap.crash).toBeNull();
    expect(snap.summary.completedArrivals).toBe(1);
    expect(snap.summary.completedDepartures).toBe(0);
    expect(snap.summary.score).toBe(snap.score);
    expect(snap.summary.duration).toBeCloseTo(sim.time);

    const time = sim.time;
    runSeconds(sim, 5);
    expect(sim.time).toBe(time);
    expect(sim.issueCommand({ type: 'PUSHBACK', aircraftId: ac.id }).ok).toBe(false);

    sim.restart();
    const fresh = sim.snapshot();
    expect(fresh.endReason).toBeNull();
    expect(fresh.summary.completedArrivals).toBe(0);
    expect(fresh.summary.penaltyPoints).toBe(0);
  });

  it('records a collision as the end reason', () => {
    const sim = quietSim();
    const a = sim.spawnDeparture('G1')!;
    const b = sim.spawnDeparture('G2')!;
    b.position = { x: a.position.x + 20, y: a.position.y };
    b.heading = a.heading;
    sim.step();
    expect(sim.snapshot().endReason).toBe('collision');
    sim.endShift();
    expect(sim.snapshot().endReason).toBe('collision');
  });
});
