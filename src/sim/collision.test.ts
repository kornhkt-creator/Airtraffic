import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { footprintGap } from './safety/CollisionSystem';
import { SIM_CONFIG } from './config';
import { distance } from './math';
import { assignPath } from './aircraft/MovementSystem';
import { planTaxi } from './aircraft/navigation';
import type { Aircraft, Command } from './types';

const NORTH = Math.PI / 2;

function quietSim(seed = 31): Simulation {
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

/** Parks an aircraft at an arbitrary pose (for geometric scenarios). */
function place(ac: Aircraft, x: number, y: number, heading: number, altitude = 0): void {
  ac.position = { x, y };
  ac.heading = heading;
  ac.altitude = altitude;
  ac.prev = { position: { x, y }, altitude, heading };
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

describe('Collision detection', () => {
  it('crashes both aircraft and ends the game exactly once', () => {
    const sim = quietSim();
    const a = departure(sim, 'G1');
    const b = departure(sim, 'G2');
    place(b, a.position.x + 20, a.position.y + 10, a.heading);
    sim.step();

    expect(a.status).toBe('CRASHED');
    expect(b.status).toBe('CRASHED');
    expect(sim.status).toBe('GAME_OVER');
    expect(sim.crash?.callsigns).toEqual([a.callsign, b.callsign]);
    const crashAlerts = () => sim.alerts.filter((x) => x.severity === 'critical');
    expect(crashAlerts()).toHaveLength(1);

    // Nothing moves or changes afterwards, and commands are refused.
    const time = sim.time;
    for (let i = 0; i < 100; i++) sim.step();
    expect(sim.time).toBe(time);
    expect(crashAlerts()).toHaveLength(1);
    expect(sim.issueCommand({ type: 'PUSHBACK', aircraftId: a.id }).ok).toBe(false);
    expect(sim.snapshot().crash?.aircraftIds).toEqual([a.id, b.id]);

    sim.restart();
    expect(sim.status).toBe('RUNNING');
    expect(sim.crash).toBeNull();
    expect(sim.aircraft.every((x) => x.status !== 'CRASHED')).toBe(true);
  });

  it('uses the aircraft footprint: wingtips touching is a collision', () => {
    const sim = quietSim();
    const a = departure(sim, 'G1');
    const b = departure(sim, 'G2');
    const span = SIM_CONFIG.aircraft.wingspan;
    // Side by side, both facing north: only the wings can touch.
    place(a, 0, 0, NORTH);
    place(b, span + 8, 0, NORTH);
    expect(footprintGap(a, b)).toBeLessThan(0);
    place(b, span + 25, 0, NORTH);
    expect(footprintGap(a, b)).toBeGreaterThan(0);
    // Nose to tail along the fuselage axis.
    place(b, 0, 70, NORTH);
    expect(footprintGap(a, b)).toBeLessThan(0);
    place(b, 0, 100, NORTH);
    expect(footprintGap(a, b)).toBeGreaterThan(0);
  });

  it('ignores aircraft that are vertically separated', () => {
    const sim = quietSim();
    const a = departure(sim, 'G1');
    const b = departure(sim, 'G2');
    place(a, 0, 0, NORTH, 300);
    place(b, 0, 0, NORTH, 300 + SIM_CONFIG.safety.verticalClearance + 5);
    expect(footprintGap(a, b)).toBe(Infinity);
  });

  it('keeps parked aircraft and lane traffic clear of each other', () => {
    const sim = quietSim();
    for (const gate of sim.routes.layout.gateIds) departure(sim, gate);
    // A taxiing aircraft on every apron node passes the parked aircraft without touching them.
    for (const n of sim.routes.layout.nodes.filter((x) => x.kind === 'apron')) {
      const probe = sim.aircraft[0]!;
      const saved = { ...probe.position };
      const savedHeading = probe.heading;
      place(probe, n.position.x, n.position.y, NORTH);
      for (const other of sim.aircraft.slice(1)) expect(footprintGap(probe, other)).toBeGreaterThan(SIM_CONFIG.safety.conflictBuffer);
      place(probe, saved.x, saved.y, savedHeading);
    }
  });
});

describe('Ground follow logic and HOLD', () => {
  /** Departure from G16 pushed back and taxiing to holding point B1. */
  function taxiingDeparture(sim: Simulation): Aircraft {
    const dep = departure(sim, 'G16');
    ok(sim, { type: 'PUSHBACK', aircraftId: dep.id });
    runUntil(sim, () => dep.nav.path === null);
    ok(sim, { type: 'TAXI', aircraftId: dep.id, destinationId: 'H1' });
    return dep;
  }

  it('stops behind traffic standing on its route instead of running into it', () => {
    const sim = quietSim();
    const dep = taxiingDeparture(sim);
    // Something stands on taxiway B, right on the departure's route.
    const blocker = departure(sim, 'G1');
    blocker.status = 'HOLDING';
    blocker.gateId = null;
    const b2 = sim.routes.node('B2').position;
    place(blocker, b2.x, b2.y, -NORTH);

    for (let i = 0; i < 300 / sim.clock.dt; i++) sim.step();
    expect(sim.crash).toBeNull();
    expect(dep.status).toBe('TAXIING');
    expect(dep.speed).toBe(0);
    expect(distance(dep.position, blocker.position)).toBeGreaterThan(SIM_CONFIG.aircraft.length);
  });

  it('holds position on command and continues when released', () => {
    const sim = quietSim();
    const dep = taxiingDeparture(sim);
    for (let i = 0; i < 100; i++) sim.step();
    ok(sim, { type: 'HOLD', aircraftId: dep.id });
    expect(sim.issueCommand({ type: 'HOLD', aircraftId: dep.id }).ok).toBe(false);
    for (let i = 0; i < 200; i++) sim.step();
    expect(dep.speed).toBe(0);
    const held = { ...dep.position };
    for (let i = 0; i < 200; i++) sim.step();
    expect(dep.position).toEqual(held);
    expect(sim.snapshot().aircraft[0]!.commands.some((c) => c.type === 'CONTINUE' && c.enabled)).toBe(true);

    ok(sim, { type: 'CONTINUE', aircraftId: dep.id });
    runUntil(sim, () => dep.status === 'HOLDING');
    expect(dep.holdingPointId).toBe('H1');
  });

  it('warns about head-on traffic, and a head-on meeting ends in a collision', () => {
    const sim = quietSim();
    const dep = taxiingDeparture(sim);
    // An arrival coming up taxiway B toward the departure, bound for a gate on the same lane.
    const arr = sim.spawnArrival({ inbound: false })!;
    arr.status = 'TAXIING';
    arr.holdingLevel = null;
    arr.destinationId = 'G13';
    arr.routeNodeIds = sim.routes.findRoute('BL', 'G13')!;
    const bl = sim.routes.node('BL').position;
    place(arr, bl.x, bl.y, NORTH);
    assignPath(arr, planTaxi(arr.routeNodeIds, sim.routes), 'taxi', 0);

    runUntil(sim, () => sim.status === 'GAME_OVER', 600);
    expect(sim.alerts.some((a) => a.message.includes('Head-on'))).toBe(true);
    expect(new Set(sim.crash!.aircraftIds)).toEqual(new Set([dep.id, arr.id]));
  });
});

describe('Runway exits', () => {
  it('a landing rolls out past an exit where an earlier arrival is still waiting', () => {
    const sim = quietSim();
    const first = sim.spawnArrival({ inbound: false })!;
    ok(sim, { type: 'LAND', aircraftId: first.id });
    runUntil(sim, () => first.status === 'LANDED' && !first.onRunway);
    const firstExit = first.exitNodeId;

    const second = sim.spawnArrival({ inbound: false })!;
    sim.step();
    ok(sim, { type: 'LAND', aircraftId: second.id });
    runUntil(sim, () => second.status === 'LANDED' && !second.onRunway);
    expect(second.exitNodeId).not.toBe(firstExit);
    expect(sim.crash).toBeNull();
  });
});
