import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { SIM_CONFIG } from './config';
import { distance } from './math';
import { findAirConflicts } from './safety/CollisionSystem';
import type { Aircraft, Command } from './types';

const NORTH = Math.PI / 2;

function quietSim(seed = 41): Simulation {
  const sim = new Simulation({ seed, autoSpawn: false });
  sim.start();
  sim.aircraft = [];
  return sim;
}

function departure(sim: Simulation, gate: string): Aircraft {
  const ac = sim.spawnDeparture(gate);
  if (!ac) throw new Error(`could not spawn at ${gate}`);
  return ac;
}

function place(ac: Aircraft, x: number, y: number, heading: number, altitude = 0): void {
  ac.position = { x, y };
  ac.heading = heading;
  ac.altitude = altitude;
  ac.prev = { position: { x, y }, altitude, heading };
}

function ok(sim: Simulation, cmd: Command): string {
  const r = sim.issueCommand(cmd);
  if (!r.ok) throw new Error(`${cmd.type} rejected: ${r.message}`);
  return r.message;
}

function runUntil(sim: Simulation, predicate: () => boolean, maxSeconds = 600): void {
  const maxTicks = Math.ceil(maxSeconds / sim.clock.dt);
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    sim.step();
  }
  throw new Error(`condition not reached within ${maxSeconds}s of sim time`);
}

/** Puts a departure straight into HOLDING at a holding point (for runway scenarios). */
function holdingAt(sim: Simulation, gate: string, holdingPointId: string): Aircraft {
  const ac = departure(sim, gate);
  const hp = sim.routes.node(holdingPointId).position;
  ac.status = 'HOLDING';
  ac.gateId = null;
  ac.holdingPointId = holdingPointId;
  place(ac, hp.x, hp.y, 0);
  return ac;
}

const alertCount = (sim: Simulation, text: string): number => sim.alerts.filter((a) => a.message.includes(text)).length;

describe('Departure queue at a holding point', () => {
  it('lets departures queue for the same holding point and keeps them apart', () => {
    const sim = quietSim();
    const first = departure(sim, 'G16');
    const second = departure(sim, 'G12');

    ok(sim, { type: 'PUSHBACK', aircraftId: first.id });
    runUntil(sim, () => first.nav.path === null);
    ok(sim, { type: 'TAXI', aircraftId: first.id, destinationId: 'H1' });
    runUntil(sim, () => sim.issueCommand({ type: 'PUSHBACK', aircraftId: second.id }).ok);
    runUntil(sim, () => second.nav.path === null);
    const clearance = ok(sim, { type: 'TAXI', aircraftId: second.id, destinationId: 'H1' });
    expect(clearance).toContain('number 2 for departure');

    // The second stops behind the first instead of joining it at the holding point.
    runUntil(sim, () => first.status === 'HOLDING');
    runUntil(sim, () => second.speed === 0 && second.status === 'TAXIING', 300);
    for (let i = 0; i < 400; i++) sim.step();
    expect(second.status).toBe('TAXIING');
    expect(distance(second.position, first.position)).toBeGreaterThan(SIM_CONFIG.aircraft.length);
    expect(sim.crash).toBeNull();

    // Once the first lines up, the queue moves up.
    ok(sim, { type: 'LINE_UP', aircraftId: first.id });
    runUntil(sim, () => second.status === 'HOLDING');
    expect(second.holdingPointId).toBe('H1');
    runUntil(sim, () => first.nav.path === null, 120);
    ok(sim, { type: 'TAKEOFF', aircraftId: first.id });
    runUntil(sim, () => sim.issueCommand({ type: 'LINE_UP', aircraftId: second.id }).ok, 120);
    runUntil(sim, () => sim.issueCommand({ type: 'TAKEOFF', aircraftId: second.id }).ok, 120);
    runUntil(sim, () => second.status === 'DEPARTED');
    expect(sim.crash).toBeNull();
    expect(sim.scoring.completedFlights).toBe(2);
  });
});

describe('Departure runway sequencing', () => {
  it('allows line up behind a departure that is already rolling, but not takeoff until it is clear', () => {
    const sim = quietSim();
    const lead = holdingAt(sim, 'G16', 'H2');
    const next = holdingAt(sim, 'G12', 'H1');

    ok(sim, { type: 'LINE_UP', aircraftId: lead.id });
    // Lead is stationary on the runway: nobody else may line up.
    expect(sim.issueCommand({ type: 'LINE_UP', aircraftId: next.id }).message).toContain('occupied');
    runUntil(sim, () => sim.issueCommand({ type: 'TAKEOFF', aircraftId: lead.id }).ok, 120);

    // Lead rolls from the intersection, far ahead of the full-length line-up point.
    ok(sim, { type: 'LINE_UP', aircraftId: next.id });
    expect(lead.onRunway).toBe(true);
    const early = sim.issueCommand({ type: 'TAKEOFF', aircraftId: next.id });
    expect(early.ok).toBe(false);
    runUntil(sim, () => next.nav.path === null, 120);
    if (lead.onRunway) expect(sim.issueCommand({ type: 'TAKEOFF', aircraftId: next.id }).message).toContain(lead.callsign);
    runUntil(sim, () => !lead.onRunway, 120);
    ok(sim, { type: 'TAKEOFF', aircraftId: next.id });
    runUntil(sim, () => next.status === 'DEPARTED');
    expect(sim.crash).toBeNull();
  });

  it('refuses to line up in front of an aircraft on its takeoff roll (runway incursion)', () => {
    const sim = quietSim();
    const roller = holdingAt(sim, 'G16', 'H1');
    const intersection = holdingAt(sim, 'G12', 'H2');
    ok(sim, { type: 'LINE_UP', aircraftId: roller.id });
    runUntil(sim, () => sim.issueCommand({ type: 'TAKEOFF', aircraftId: roller.id }).ok, 120);
    sim.step();
    const r = sim.issueCommand({ type: 'LINE_UP', aircraftId: intersection.id });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('runway incursion');
    expect(intersection.status).toBe('HOLDING');
    runUntil(sim, () => roller.status === 'DEPARTED');
    expect(sim.crash).toBeNull();
  });
});

describe('Airborne separation warning', () => {
  it('warns once when airborne aircraft get too close, without ending the game', () => {
    const sim = quietSim();
    const a = sim.spawnArrival({ inbound: false })!;
    const b = sim.spawnArrival({ inbound: false })!;
    place(a, -2500, 1500, 0, 400);
    place(b, -2500 + SIM_CONFIG.safety.airHorizontal - 100, 1500, Math.PI, 400 + SIM_CONFIG.safety.airVertical - 20);
    a.nav.path = null;
    b.nav.path = null;
    sim.step();
    expect(a.conflict && b.conflict).toBe(true);
    expect(alertCount(sim, 'Separation lost')).toBe(1);
    for (let i = 0; i < 20; i++) sim.step();
    expect(alertCount(sim, 'Separation lost')).toBe(1);
    expect(sim.status).toBe('RUNNING');
  });

  it('does not warn about aircraft one stack level apart', () => {
    const sim = quietSim();
    const a = sim.spawnArrival({ inbound: false })!;
    const b = sim.spawnArrival({ inbound: false })!;
    const [l0, l1] = SIM_CONFIG.air.holdingLevels;
    place(a, -2500, 1500, 0, l0);
    place(b, -2500, 1500, 0, l1);
    expect(findAirConflicts(sim.aircraft)).toHaveLength(0);
  });
});

describe('Runway incursion detection', () => {
  it('flags a ground aircraft on a runway without clearance', () => {
    const sim = quietSim();
    const stray = departure(sim, 'G1');
    stray.status = 'HOLDING';
    stray.gateId = null;
    const rwy = sim.routes.layout.arrivalRunway;
    place(stray, rwy.start.x + 10, rwy.start.y + 600, NORTH);
    sim.step();
    expect(stray.conflict).toBe(true);
    expect(alertCount(sim, 'RUNWAY INCURSION')).toBe(1);
    sim.step();
    expect(alertCount(sim, 'RUNWAY INCURSION')).toBe(1);
  });

  it('does not flag aircraft cleared onto their runway', () => {
    const sim = quietSim();
    const dep = holdingAt(sim, 'G16', 'H1');
    ok(sim, { type: 'LINE_UP', aircraftId: dep.id });
    runUntil(sim, () => dep.nav.path === null, 120);
    ok(sim, { type: 'TAKEOFF', aircraftId: dep.id });
    runUntil(sim, () => dep.status === 'DEPARTED');
    expect(alertCount(sim, 'RUNWAY INCURSION')).toBe(0);
  });
});

/** Controller that sends every departure to the same holding point and sequences the runway. */
function queueingAutopilot(sim: Simulation): void {
  for (const a of [...sim.aircraft]) {
    const tries: Command[] = [];
    if (a.status === 'APPROACH') tries.push({ type: 'LAND', aircraftId: a.id });
    if (a.status === 'LANDED' && !a.destinationId) for (const g of sim.freeGates()) tries.push({ type: 'TAXI', aircraftId: a.id, destinationId: g });
    if (a.status === 'AT_GATE' && a.flightType === 'DEPARTURE') tries.push({ type: 'PUSHBACK', aircraftId: a.id });
    if (a.status === 'PUSHBACK' && !a.destinationId) tries.push({ type: 'TAXI', aircraftId: a.id, destinationId: 'H1' });
    if (a.status === 'HOLDING') tries.push({ type: 'LINE_UP', aircraftId: a.id });
    if (a.status === 'LINE_UP') tries.push({ type: 'TAKEOFF', aircraftId: a.id });
    for (const cmd of tries) if (sim.issueCommand(cmd).ok) break;
  }
}

describe('Long queued traffic runs', () => {
  /**
   * The test controller ignores every warning, so collisions do happen. The safety system's job is
   * to see them coming: every collision must be preceded by a warning naming both aircraft.
   */
  it('warns before every collision and keeps airborne traffic separated', () => {
    const warningLead = 5;
    let completed = 0;
    let crashes = 0;
    let maxQueue = 0;
    for (const seed of [123, 7, 99, 2024, 31337]) {
      const sim = new Simulation({ seed });
      sim.start();
      const ticksPerSecond = Math.round(1 / sim.clock.dt);
      const firstWarned = new Map<string, number>();
      let airConflicts = 0;
      for (let t = 0; t < 20 * 60 * ticksPerSecond && sim.status === 'RUNNING'; t++) {
        if (t % ticksPerSecond === 0) queueingAutopilot(sim);
        sim.step();
        airConflicts += findAirConflicts(sim.aircraft).length;
        maxQueue = Math.max(maxQueue, sim.aircraft.filter((a) => a.destinationId === 'H1' || a.holdingPointId === 'H1').length);
        for (const alert of sim.alerts) {
          if (alert.severity !== 'warning' || firstWarned.has(alert.message)) continue;
          firstWarned.set(alert.message, alert.time);
        }
      }
      expect(airConflicts).toBe(0);
      completed += sim.scoring.completedFlights;
      if (sim.crash) {
        crashes++;
        const [c1, c2] = sim.crash.callsigns;
        const warnedAt = [...firstWarned].filter(([msg]) => msg.includes(c1) && msg.includes(c2)).map(([, time]) => time);
        expect(warnedAt.length, `crash ${c1}/${c2} (seed ${seed}) had no warning`).toBeGreaterThan(0);
        expect(sim.crash.time - Math.min(...warnedAt)).toBeGreaterThanOrEqual(warningLead);
      }
    }
    expect(maxQueue).toBeGreaterThan(1);
    expect(completed).toBeGreaterThanOrEqual(10);
    // Report how often an inattentive controller still collides.
    expect(crashes).toBeLessThanOrEqual(5);
  });
});
