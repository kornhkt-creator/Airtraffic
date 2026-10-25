import { describe, expect, it } from 'vitest';
import { Simulation } from './Simulation';
import { SimulationClock } from './SimulationClock';
import { AIRPORT } from './airport/layout';
import { RouteManager } from './airport/RouteManager';
import { canTransition, InvalidTransitionError, transition, TRANSITIONS } from './aircraft/AircraftStateMachine';
import { ScoringSystem } from './ScoringSystem';
import { AIRCRAFT_STATUSES, type Aircraft, type AircraftStatus } from './types';
import { distance } from './math';

/** Started game with only its arrival (the random departure is removed so gates are predictable). */
function startedSim(seed = 7): { sim: Simulation; ac: Aircraft } {
  const sim = new Simulation({ seed });
  sim.start();
  sim.aircraft = sim.aircraft.filter((a) => a.flightType === 'ARRIVAL');
  const ac = sim.aircraft[0];
  if (!ac) throw new Error('no aircraft spawned');
  return { sim, ac };
}

/** Steps until the predicate holds; fails the test if it takes longer than maxSeconds. */
function runUntil(sim: Simulation, predicate: () => boolean, maxSeconds = 600): void {
  const maxTicks = Math.ceil(maxSeconds / sim.clock.dt);
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    sim.step();
  }
  throw new Error(`condition not reached within ${maxSeconds}s of sim time`);
}

describe('AircraftStateMachine', () => {
  it('allows only listed transitions', () => {
    expect(canTransition('APPROACH', 'LANDING')).toBe(true);
    expect(canTransition('LANDING', 'LANDED')).toBe(true);
    expect(canTransition('APPROACH', 'TAXIING')).toBe(false);
    expect(canTransition('AT_GATE', 'APPROACH')).toBe(false);
    for (const terminal of ['DEPARTED', 'DIVERTED', 'CRASHED'] as const) expect(TRANSITIONS[terminal]).toHaveLength(0);
  });

  it('every state can crash except terminal states', () => {
    for (const s of AIRCRAFT_STATUSES) {
      const terminal = s === 'DEPARTED' || s === 'DIVERTED' || s === 'CRASHED';
      expect(canTransition(s as AircraftStatus, 'CRASHED')).toBe(!terminal);
    }
  });

  it('throws on invalid transitions without changing the state', () => {
    const { ac } = startedSim();
    expect(() => transition(ac, 'TAKEOFF', () => {})).toThrow(InvalidTransitionError);
    expect(ac.status).toBe('APPROACH');
  });
});

describe('RouteManager', () => {
  const routes = new RouteManager(AIRPORT);

  it('finds the shortest taxi route from a runway exit to a gate', () => {
    expect(routes.findRoute('X2', 'G1')).toEqual(['X2', 'T2', 'TW', 'PW', 'P1', 'G1']);
  });

  it('never routes over the runway', () => {
    for (const gate of AIRPORT.gateIds) {
      for (const exit of ['X2', 'X3', 'X4']) {
        const route = routes.findRoute(exit, gate);
        expect(route).not.toBeNull();
        expect(route!.some((id) => id.startsWith('R'))).toBe(false);
        expect(routes.isValidRoute(route!)).toBe(true);
      }
    }
  });

  it('returns null for nodes only reachable through the runway', () => {
    expect(routes.findRoute('X2', 'R3')).toBeNull();
    expect(routes.findRoute('X2', 'NOPE')).toBeNull();
  });
});

describe('SimulationClock', () => {
  it('runs the same number of ticks regardless of frame rate', () => {
    const fast = new SimulationClock(20);
    const slow = new SimulationClock(20);
    let fastTicks = 0;
    let slowTicks = 0;
    for (let i = 0; i < 144 * 10; i++) fastTicks += fast.consume(1 / 144);
    for (let i = 0; i < 30 * 10; i++) slowTicks += slow.consume(1 / 30);
    expect(fastTicks).toBe(200);
    expect(slowTicks).toBe(200);
  });

  it('applies time scale and clamps huge frame gaps', () => {
    const clock = new SimulationClock(20);
    clock.timeScale = 4;
    expect(clock.consume(0.1)).toBe(8);
    expect(clock.consume(10)).toBe(20); // clamped to 0.25 s * 4
  });
});

describe('ScoringSystem', () => {
  it('scores each flight only once', () => {
    const scoring = new ScoringSystem();
    expect(scoring.recordCompletion('AC1')).toBe(100);
    expect(scoring.recordCompletion('AC1')).toBeNull();
    expect(scoring.score).toBe(100);
    expect(scoring.completedFlights).toBe(1);
  });
});

describe('Commands', () => {
  it('rejects LAND before the game starts', () => {
    const sim = new Simulation();
    expect(sim.issueCommand({ type: 'LAND', aircraftId: 'AC1' }).ok).toBe(false);
  });

  it('accepts LAND in APPROACH and changes actual behavior', () => {
    const { sim, ac } = startedSim();
    const before = ac.nav.version;
    const result = sim.issueCommand({ type: 'LAND', aircraftId: ac.id });
    expect(result.ok).toBe(true);
    expect(ac.status).toBe('LANDING');
    expect(ac.nav.kind).toBe('approach');
    expect(ac.nav.version).toBeGreaterThan(before);
  });

  it('rejects a second LAND clearance and TAXI while airborne', () => {
    const { sim, ac } = startedSim();
    sim.issueCommand({ type: 'LAND', aircraftId: ac.id });
    const again = sim.issueCommand({ type: 'LAND', aircraftId: ac.id });
    expect(again.ok).toBe(false);
    expect(again.message).toContain('APPROACH');
    const taxi = sim.issueCommand({ type: 'TAXI', aircraftId: ac.id, destinationId: 'G1' });
    expect(taxi.ok).toBe(false);
    expect(ac.status).toBe('LANDING');
  });

  it('rejects LAND while the runway is occupied by another aircraft', () => {
    const { sim, ac } = startedSim();
    const second = sim.spawnArrival();
    expect(sim.issueCommand({ type: 'LAND', aircraftId: ac.id }).ok).toBe(true);
    const r = sim.issueCommand({ type: 'LAND', aircraftId: second.id });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('occupied');
    expect(second.status).toBe('APPROACH');
  });

  it('rejects TAXI to an unknown or non-gate destination', () => {
    const { sim, ac } = startedSim();
    sim.issueCommand({ type: 'LAND', aircraftId: ac.id });
    runUntil(sim, () => ac.status === 'LANDED');
    expect(sim.issueCommand({ type: 'TAXI', aircraftId: ac.id, destinationId: 'ZZ' }).ok).toBe(false);
    expect(sim.issueCommand({ type: 'TAXI', aircraftId: ac.id, destinationId: 'T3' }).ok).toBe(false);
  });

  it('rejects TAXI to a gate reserved by another aircraft', () => {
    const { sim, ac } = startedSim();
    const other = sim.spawnArrival();
    other.gateId = 'G2';
    sim.issueCommand({ type: 'LAND', aircraftId: ac.id });
    runUntil(sim, () => ac.status === 'LANDED');
    const r = sim.issueCommand({ type: 'TAXI', aircraftId: ac.id, destinationId: 'G2' });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('occupied');
  });
});

describe('Arrival lifecycle', () => {
  it('lands, vacates the runway, taxis to the gate and scores exactly once', () => {
    const { sim, ac } = startedSim();
    sim.issueCommand({ type: 'LAND', aircraftId: ac.id });

    let maxStep = 0;
    let lastPos = { ...ac.position };
    const track = (): void => {
      maxStep = Math.max(maxStep, distance(lastPos, ac.position) - ac.speed * sim.clock.dt);
      lastPos = { ...ac.position };
    };

    runUntil(sim, () => {
      track();
      return ac.status === 'LANDED';
    });
    expect(ac.altitude).toBe(0);
    expect(Math.abs(ac.position.y)).toBeLessThan(1);
    expect(ac.onRunway).toBe(true);

    runUntil(sim, () => {
      track();
      return !ac.onRunway;
    });
    expect(ac.speed).toBe(0);
    expect(sim.snapshot().runwayOccupiedBy).toHaveLength(0);

    expect(sim.issueCommand({ type: 'TAXI', aircraftId: ac.id, destinationId: 'G1' }).ok).toBe(true);
    expect(ac.status).toBe('TAXIING');
    runUntil(sim, () => {
      track();
      return ac.status === 'AT_GATE';
    });

    const gate = sim.routes.node('G1').position;
    expect(distance(ac.position, gate)).toBeLessThan(0.5);
    expect(ac.gateId).toBe('G1');
    expect(sim.scoring.score).toBe(100);
    // Movement never jumps further than speed * dt (+ tiny numeric slack): no teleporting.
    expect(maxStep).toBeLessThan(0.6);

    for (let i = 0; i < 200; i++) sim.step();
    expect(sim.scoring.score).toBe(100);
    expect(sim.scoring.completedFlights).toBe(1);
  });

  it('continues straight into the taxi route when TAXI is issued during rollout', () => {
    const { sim, ac } = startedSim();
    sim.issueCommand({ type: 'LAND', aircraftId: ac.id });
    runUntil(sim, () => ac.status === 'LANDED');
    expect(sim.issueCommand({ type: 'TAXI', aircraftId: ac.id, destinationId: 'G3' }).ok).toBe(true);
    expect(ac.status).toBe('LANDED');
    expect(ac.pendingRoute).not.toBeNull();
    runUntil(sim, () => ac.status === 'TAXIING');
    expect(ac.speed).toBeGreaterThan(0);
    runUntil(sim, () => ac.status === 'AT_GATE');
    expect(ac.gateId).toBe('G3');
  });

  it('lands successfully from every point of the holding pattern', () => {
    for (let k = 0; k < 12; k++) {
      const { sim, ac } = startedSim(100 + k);
      ac.nav.s = (sim.holdingLoop.length * k) / 12;
      sim.step();
      sim.issueCommand({ type: 'LAND', aircraftId: ac.id });
      runUntil(sim, () => ac.status === 'LANDED');
      expect(ac.position.x).toBeCloseTo(AIRPORT.runway.touchdown.x, 0);
      // Altitude before the touchdown tick: the glide path was actually flown (no snap from altitude).
      expect(ac.prev.altitude).toBeLessThan(3);
    }
  });
});

describe('Determinism and reset', () => {
  it('produces identical results for the same seed', () => {
    const run = (): string => {
      const { sim, ac } = startedSim(3);
      for (let i = 0; i < 400; i++) sim.step();
      sim.issueCommand({ type: 'LAND', aircraftId: ac.id });
      for (let i = 0; i < 1500; i++) sim.step();
      return JSON.stringify({ p: ac.position, a: ac.altitude, s: ac.status, c: ac.callsign });
    };
    expect(run()).toBe(run());
  });

  it('restart fully resets the game state', () => {
    const { sim, ac } = startedSim();
    sim.issueCommand({ type: 'LAND', aircraftId: ac.id });
    sim.setTimeScale(4);
    for (let i = 0; i < 500; i++) sim.step();
    sim.scoring.recordCompletion('X');
    sim.restart();
    expect(sim.status).toBe('RUNNING');
    expect(sim.time).toBe(0);
    expect(sim.scoring.score).toBe(0);
    expect(sim.clock.timeScale).toBe(1);
    expect(sim.aircraft).toHaveLength(2);
    expect(sim.aircraft[0]!.status).toBe('APPROACH');
    expect(sim.aircraft[1]!.status).toBe('AT_GATE');
    expect(sim.aircraft[0]!.callsign).toBe(ac.callsign);
  });

  it('does not advance while paused', () => {
    const { sim, ac } = startedSim();
    sim.pause();
    const pos = { ...ac.position };
    expect(sim.advance(0.2)).toBe(0);
    expect(ac.position).toEqual(pos);
    sim.resume();
    expect(sim.advance(0.2)).toBe(4);
  });
});
