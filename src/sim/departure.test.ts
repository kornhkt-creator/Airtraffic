import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { AIRPORT } from './airport/layout';
import { SIM_CONFIG } from './config';
import { angleDiff, distance, dot, fromAngle, sub } from './math';
import type { Aircraft } from './types';

/** Started game with a single departure parked at the given gate (the random spawns are removed). */
function departureSim(gate = 'G4', seed = 11): { sim: Simulation; dep: Aircraft } {
  const sim = new Simulation({ seed, autoSpawn: false });
  sim.start();
  sim.aircraft = [];
  const dep = sim.spawnDeparture(gate);
  if (!dep) throw new Error('could not spawn departure');
  return { sim, dep };
}

function spawnArrival(sim: Simulation): Aircraft {
  const a = sim.spawnArrival({ inbound: false });
  if (!a) throw new Error('holding stack full');
  return a;
}

function runUntil(sim: Simulation, predicate: () => boolean, maxSeconds = 600, onTick?: () => void): void {
  const maxTicks = Math.ceil(maxSeconds / sim.clock.dt);
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    sim.step();
    onTick?.();
  }
  throw new Error(`condition not reached within ${maxSeconds}s of sim time`);
}

function ok(sim: Simulation, cmd: Parameters<Simulation['issueCommand']>[0]): void {
  const r = sim.issueCommand(cmd);
  if (!r.ok) throw new Error(`${cmd.type} rejected: ${r.message}`);
}

describe('Departure lifecycle', () => {
  it('pushes back, taxis, holds, lines up, takes off and scores exactly once', () => {
    const { sim, dep } = departureSim('G4');
    const id = dep.id;
    const runway = AIRPORT.departureRunway;
    expect(dep.status).toBe('AT_GATE');
    expect(sim.freeGates()).not.toContain('G4');

    let lastPos = { ...dep.position };
    let lastHeading = dep.heading;
    let maxExtraStep = 0;
    let maxHeadingJump = 0;
    const track = (): void => {
      maxExtraStep = Math.max(maxExtraStep, distance(lastPos, dep.position) - dep.speed * sim.clock.dt);
      maxHeadingJump = Math.max(maxHeadingJump, Math.abs(angleDiff(lastHeading, dep.heading)));
      lastPos = { ...dep.position };
      lastHeading = dep.heading;
    };

    // Pushback: moves tail-first.
    ok(sim, { type: 'PUSHBACK', aircraftId: id });
    expect(dep.status).toBe('PUSHBACK');
    for (let i = 0; i < 60; i++) {
      const before = { ...dep.position };
      sim.step();
      track();
      const moved = sub(dep.position, before);
      if (Math.hypot(moved.x, moved.y) > 1e-3) expect(dot(moved, fromAngle(dep.heading))).toBeLessThan(0);
    }
    runUntil(sim, () => dep.nav.path === null, 300, track);
    expect(dep.status).toBe('PUSHBACK');
    expect(dep.gateId).toBeNull();
    expect(sim.freeGates()).toContain('G4');

    // Taxi to the holding point.
    ok(sim, { type: 'TAXI', aircraftId: id, destinationId: 'H1' });
    expect(dep.status).toBe('TAXIING');
    runUntil(sim, () => dep.status === 'HOLDING', 600, track);
    expect(distance(dep.position, sim.routes.node('H1').position)).toBeLessThan(0.5);
    expect(dep.holdingPointId).toBe('H1');
    // The nose (half a fuselage ahead of the reference point) stays behind the hold-short line.
    expect(dep.position.x + SIM_CONFIG.aircraft.length / 2).toBeLessThan(runway.start.x - AIRPORT.holdShortOffset);
    expect(sim.snapshot().runways.every((r) => r.occupiedBy.length === 0)).toBe(true);

    // Line up: occupies the runway and ends aligned with it.
    ok(sim, { type: 'LINE_UP', aircraftId: id });
    expect(dep.status).toBe('LINE_UP');
    expect(dep.onRunway).toBe(true);
    runUntil(sim, () => dep.nav.path === null, 300, track);
    expect(Math.abs(angleDiff(dep.heading, runway.heading))).toBeLessThan(1e-3);
    expect(Math.abs(dep.position.x - runway.start.x)).toBeLessThan(0.5);

    // Takeoff: accelerates, lifts off, vacates the runway, departs.
    ok(sim, { type: 'TAKEOFF', aircraftId: id });
    runUntil(sim, () => dep.altitude > 0, 120, track);
    expect(dep.speed).toBeGreaterThanOrEqual(SIM_CONFIG.departure.rotationSpeed);
    expect(dep.position.y).toBeLessThan(runway.end.y);
    runUntil(sim, () => !dep.onRunway, 120, track);
    expect(dep.position.y).toBeGreaterThan(runway.end.y);
    expect(dep.altitude).toBeGreaterThan(30);
    runUntil(sim, () => dep.status === 'DEPARTED', 300, track);

    expect(sim.scoring.score).toBe(100);
    expect(sim.scoring.completedFlights).toBe(1);
    expect(maxExtraStep).toBeLessThan(0.6);
    // Smooth motion: heading never jumps more than a few degrees in one tick.
    expect(maxHeadingJump).toBeLessThan(0.1);

    for (let i = 0; i < 200; i++) sim.step();
    expect(sim.scoring.score).toBe(100);
    expect(sim.snapshot().activeFlights).toBe(0);
  });

  it('can push back from every gate and reach the holding point', () => {
    for (const gate of AIRPORT.gateIds) {
      const { sim, dep } = departureSim(gate);
      ok(sim, { type: 'PUSHBACK', aircraftId: dep.id });
      runUntil(sim, () => dep.nav.path === null);
      ok(sim, { type: 'TAXI', aircraftId: dep.id, destinationId: 'H1' });
      runUntil(sim, () => dep.status === 'HOLDING');
    }
  });

  it('starts a TAXI issued during pushback once the pushback ends', () => {
    const { sim, dep } = departureSim('G2');
    ok(sim, { type: 'PUSHBACK', aircraftId: dep.id });
    sim.step();
    ok(sim, { type: 'TAXI', aircraftId: dep.id, destinationId: 'H1' });
    expect(dep.status).toBe('PUSHBACK');
    expect(dep.pendingRoute).not.toBeNull();
    runUntil(sim, () => dep.status === 'TAXIING');
    runUntil(sim, () => dep.status === 'HOLDING');
  });
});

describe('Departure command validation', () => {
  it('rejects commands out of order with explanations', () => {
    const { sim, dep } = departureSim();
    const id = dep.id;
    const taxi = sim.issueCommand({ type: 'TAXI', aircraftId: id, destinationId: 'H1' });
    expect(taxi.ok).toBe(false);
    expect(taxi.message).toContain('PUSHBACK');
    expect(sim.issueCommand({ type: 'LINE_UP', aircraftId: id }).ok).toBe(false);
    expect(sim.issueCommand({ type: 'TAKEOFF', aircraftId: id }).ok).toBe(false);
    expect(sim.issueCommand({ type: 'LAND', aircraftId: id }).ok).toBe(false);
    expect(dep.status).toBe('AT_GATE');

    ok(sim, { type: 'PUSHBACK', aircraftId: id });
    expect(sim.issueCommand({ type: 'PUSHBACK', aircraftId: id }).ok).toBe(false);
    runUntil(sim, () => dep.nav.path === null);
    const toGate = sim.issueCommand({ type: 'TAXI', aircraftId: id, destinationId: 'G1' });
    expect(toGate.ok).toBe(false);
    expect(toGate.message).toContain('holding point');

    ok(sim, { type: 'TAXI', aircraftId: id, destinationId: 'H1' });
    runUntil(sim, () => dep.status === 'HOLDING');
    expect(sim.issueCommand({ type: 'TAKEOFF', aircraftId: id }).ok).toBe(false);
    ok(sim, { type: 'LINE_UP', aircraftId: id });
    const early = sim.issueCommand({ type: 'TAKEOFF', aircraftId: id });
    expect(early.ok).toBe(false);
    expect(early.message).toContain('lining up');
  });

  it('rejects PUSHBACK for an arrival parked at a gate', () => {
    const { sim } = departureSim();
    const arr = spawnArrival(sim);
    arr.status = 'AT_GATE';
    arr.gateId = 'G1';
    const r = sim.issueCommand({ type: 'PUSHBACK', aircraftId: arr.id });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('arrival');
  });

  it('blocks PUSHBACK when other ground traffic is behind the stand', () => {
    const { sim, dep } = departureSim('G1');
    const other = sim.spawnDeparture('G2');
    if (!other) throw new Error('spawn failed');
    other.status = 'TAXIING';
    other.gateId = null;
    other.position = { ...sim.routes.node('CO230').position, y: sim.routes.node('CO230').position.y + 30 };
    const r = sim.issueCommand({ type: 'PUSHBACK', aircraftId: dep.id });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('not clear');
  });

  it('runs arrivals and departures on separate runways, each exclusive', () => {
    const { sim, dep } = departureSim();
    ok(sim, { type: 'PUSHBACK', aircraftId: dep.id });
    runUntil(sim, () => dep.nav.path === null);
    ok(sim, { type: 'TAXI', aircraftId: dep.id, destinationId: 'H1' });
    runUntil(sim, () => dep.status === 'HOLDING');
    // Spawned only now: an arrival kept holding through the whole taxi would divert.
    const arr = spawnArrival(sim);

    // A landing on 01L does not block a departure lining up on 01R.
    ok(sim, { type: 'LAND', aircraftId: arr.id });
    ok(sim, { type: 'LINE_UP', aircraftId: dep.id });
    const runways = sim.snapshot().runways;
    expect(runways.find((r) => r.use === 'ARRIVALS')?.occupiedBy).toEqual([arr.callsign]);
    expect(runways.find((r) => r.use === 'MIXED')?.occupiedBy).toEqual([dep.callsign]);

    // But each runway takes one aircraft at a time.
    runUntil(sim, () => arr.status === 'LANDED');
    const second = spawnArrival(sim);
    sim.step();
    const land = sim.issueCommand({ type: 'LAND', aircraftId: second.id });
    expect(land.ok).toBe(false);
    expect(land.message).toContain(arr.callsign);
    expect(land.message).toContain('01L');
  });

  it('only spawns departures at free gates', () => {
    const { sim } = departureSim('G1');
    expect(sim.spawnDeparture('G1')).toBeNull();
    expect(sim.spawnDeparture('G2')).not.toBeNull();
    while (sim.freeGates().length > 0) expect(sim.spawnDeparture()).not.toBeNull();
    expect(sim.spawnDeparture()).toBeNull();
    expect(sim.aircraft).toHaveLength(AIRPORT.gateIds.length);
    const callsigns = sim.aircraft.map((a) => a.callsign);
    expect(new Set(callsigns).size).toBe(callsigns.length);
  });
});
