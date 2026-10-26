import type { Aircraft } from './types';
import type { Rng } from './rng';
import { SIM_CONFIG } from './config';
import { clamp, lerp } from './math';
import { freeHoldingLevel, HOLDING_LEVELS } from './aircraft/holdingStack';

/** What the spawn system needs from the simulation. */
export interface SpawnHost {
  readonly time: number;
  readonly aircraft: readonly Aircraft[];
  spawnArrival(options: { inbound: boolean }): Aircraft | null;
  spawnDeparture(gateId?: string): Aircraft | null;
  freeGates(): string[];
  removeAircraft(id: string): void;
}

const T = SIM_CONFIG.traffic;

/** Difficulty progress 0..1 over the ramp duration. */
export const difficultyProgress = (time: number): number => clamp(time / T.rampDuration, 0, 1);

/** Difficulty level shown to the player (1..difficultyLevels). */
export function difficultyLevel(time: number): number {
  return Math.min(T.difficultyLevels, 1 + Math.floor(difficultyProgress(time) * T.difficultyLevels));
}

function ramp(range: { start: number; end: number }, time: number): number {
  return lerp(range.start, range.end, difficultyProgress(time));
}

function rampInterval(range: { start: readonly number[]; end: readonly number[] }, time: number, rng: Rng): number {
  const p = difficultyProgress(time);
  const lo = lerp(range.start[0] ?? 0, range.end[0] ?? 0, p);
  const hi = lerp(range.start[1] ?? 0, range.end[1] ?? 0, p);
  return rng.range(lo, hi);
}

const isFinished = (a: Aircraft): boolean => a.status === 'DEPARTED' || a.status === 'DIVERTED' || a.status === 'CRASHED';
const isAirborneArrival = (a: Aircraft): boolean => a.flightType === 'ARRIVAL' && (a.status === 'APPROACH' || a.status === 'LANDING' || a.status === 'GO_AROUND');

/** Flights the controller still has to handle (parked arrivals are done). */
export const isActiveFlight = (a: Aircraft): boolean => !isFinished(a) && !(a.flightType === 'ARRIVAL' && a.status === 'AT_GATE');

/**
 * Schedules new traffic with a difficulty ramp, turns parked arrivals into departures, and removes
 * flights that have left the simulation.
 */
export class SpawnSystem {
  nextArrivalAt = 0;
  nextDepartureAt = 0;

  reset(time: number, rng: Rng): void {
    this.nextArrivalAt = time + rampInterval(T.arrivalInterval, time, rng);
    this.nextDepartureAt = time + rampInterval(T.departureInterval, time, rng);
  }

  maxActive(time: number): number {
    return Math.round(ramp(T.maxActive, time));
  }

  maxAirborneArrivals(time: number): number {
    return Math.min(HOLDING_LEVELS.length, Math.round(ramp(T.maxAirborneArrivals, time)));
  }

  /** Turnarounds and cleanup always run; new traffic is scheduled only when `schedule` is true. */
  update(host: SpawnHost, rng: Rng, schedule = true): void {
    const { time } = host;
    this.turnarounds(host);
    this.cleanup(host);
    if (!schedule) return;

    const active = host.aircraft.filter(isActiveFlight).length;
    if (time >= this.nextArrivalAt) {
      const airborne = host.aircraft.filter(isAirborneArrival).length;
      const canSpawn = active < this.maxActive(time) && airborne < this.maxAirborneArrivals(time) && freeHoldingLevel(host.aircraft) !== null;
      const spawned = canSpawn ? host.spawnArrival({ inbound: true }) : null;
      this.nextArrivalAt = time + (spawned ? rampInterval(T.arrivalInterval, time, rng) : T.retryDelay);
    }
    if (time >= this.nextDepartureAt) {
      const nowActive = host.aircraft.filter(isActiveFlight).length;
      const canSpawn = nowActive < this.maxActive(time) && host.freeGates().length > T.keepFreeGates;
      const spawned = canSpawn ? host.spawnDeparture() : null;
      this.nextDepartureAt = time + (spawned ? rampInterval(T.departureInterval, time, rng) : T.retryDelay);
    }
  }

  /** Arrivals parked long enough are replaced by a departure at the same gate. */
  private turnarounds(host: SpawnHost): void {
    const ready = host.aircraft.filter((a) => a.flightType === 'ARRIVAL' && a.status === 'AT_GATE' && a.gateTime >= T.turnaroundTime);
    for (const arrival of ready) {
      const gate = arrival.gateId;
      host.removeAircraft(arrival.id);
      if (gate) host.spawnDeparture(gate);
    }
  }

  /** Departed and diverted flights leave once they reach the end of their exit path. */
  private cleanup(host: SpawnHost): void {
    for (const a of host.aircraft.filter((x) => isFinished(x) && x.status !== 'CRASHED' && x.nav.path === null)) {
      host.removeAircraft(a.id);
    }
  }
}
