import type { Aircraft } from '../types';
import { SIM_CONFIG } from '../config';

/**
 * Holding stack (simplified game rule): every inbound or holding arrival owns one altitude level,
 * so aircraft sharing the holding pattern are always vertically separated. Only the bottom level
 * may be cleared to land; when it empties, the aircraft above step down one level at a time.
 */
export const HOLDING_LEVELS: readonly number[] = SIM_CONFIG.air.holdingLevels;

export function levelAltitude(level: number | null): number {
  return HOLDING_LEVELS[level ?? 0] ?? SIM_CONFIG.air.holdingAltitude;
}

/** Lowest level not owned by any aircraft, or null when the stack is full. */
export function freeHoldingLevel(aircraft: readonly Aircraft[]): number | null {
  for (let level = 0; level < HOLDING_LEVELS.length; level++) {
    if (!aircraft.some((a) => a.holdingLevel === level)) return level;
  }
  return null;
}

/**
 * Moves holding arrivals down into empty levels below them. Diverting aircraft keep their level
 * until they leave, so nobody descends into their altitude while they are still nearby.
 */
export function compactHoldingStack(aircraft: readonly Aircraft[]): void {
  // A landing aircraft releases its level only once it is clear below the stack, so the aircraft
  // above never descends onto it while it is still flying out of the holding area.
  const releaseBelow = levelAltitude(0) - SIM_CONFIG.air.stackClearance;
  for (const a of aircraft) {
    if (a.holdingLevel === null) continue;
    const clearBelow = a.status === 'LANDING' && a.altitude <= releaseBelow;
    const leftAirspace = a.status !== 'APPROACH' && a.status !== 'LANDING' && a.status !== 'DIVERTED';
    if (clearBelow || leftAirspace) a.holdingLevel = null;
  }
  for (let level = 0; level < HOLDING_LEVELS.length; level++) {
    if (aircraft.some((a) => a.holdingLevel === level)) continue;
    let candidate: Aircraft | null = null;
    for (const a of aircraft) {
      if (a.status !== 'APPROACH' || a.holdingLevel === null || a.holdingLevel <= level) continue;
      if (!candidate || (candidate.holdingLevel ?? Infinity) > a.holdingLevel) candidate = a;
    }
    if (candidate) candidate.holdingLevel = level;
  }
}
