import type { Aircraft, AircraftStatus, SimEvent } from '../types';

/** Every allowed status change. Anything not listed here is rejected. */
export const TRANSITIONS: Readonly<Record<AircraftStatus, readonly AircraftStatus[]>> = {
  APPROACH: ['LANDING', 'DIVERTED', 'CRASHED'],
  LANDING: ['LANDED', 'GO_AROUND', 'CRASHED'],
  GO_AROUND: ['APPROACH', 'CRASHED'],
  LANDED: ['TAXIING', 'CRASHED'],
  TAXIING: ['HOLDING', 'AT_GATE', 'CRASHED'],
  HOLDING: ['TAXIING', 'LINE_UP', 'CRASHED'],
  AT_GATE: ['PUSHBACK', 'CRASHED'],
  PUSHBACK: ['TAXIING', 'CRASHED'],
  LINE_UP: ['TAKEOFF', 'CRASHED'],
  TAKEOFF: ['DEPARTED', 'CRASHED'],
  DEPARTED: [],
  DIVERTED: [],
  CRASHED: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: AircraftStatus,
    readonly to: AircraftStatus,
  ) {
    super(`Invalid aircraft state transition ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: AircraftStatus, to: AircraftStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Applies a validated status change and reports it. Throws on an invalid transition. */
export function transition(ac: Aircraft, to: AircraftStatus, emit: (e: SimEvent) => void): void {
  const from = ac.status;
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
  ac.status = to;
  emit({ type: 'STATUS_CHANGED', aircraftId: ac.id, from, to });
}
