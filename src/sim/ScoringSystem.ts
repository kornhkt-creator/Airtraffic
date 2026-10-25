import { SIM_CONFIG } from './config';
import type { FlightType } from './types';

export type PenaltyReason = 'diversion';

const PENALTY_POINTS: Record<PenaltyReason, number> = {
  diversion: SIM_CONFIG.scoring.diversionPenalty,
};

/** Awards points once per flight; repeated completion or penalty events for the same flight are ignored. */
export class ScoringSystem {
  score = 0;
  completedFlights = 0;
  diversions = 0;
  penaltyPoints = 0;
  private readonly scored = new Set<string>();
  private readonly penalized = new Set<string>();

  /** Returns the points awarded, or null if this flight was already scored. */
  recordCompletion(aircraftId: string, flightType: FlightType = 'ARRIVAL'): number | null {
    if (this.scored.has(aircraftId)) return null;
    this.scored.add(aircraftId);
    const points = flightType === 'ARRIVAL' ? SIM_CONFIG.scoring.arrivalCompleted : SIM_CONFIG.scoring.departureCompleted;
    this.score += points;
    this.completedFlights += 1;
    return points;
  }

  /** Deducts a penalty once per (flight, reason). Returns the points deducted, or null if already applied. */
  recordPenalty(aircraftId: string, reason: PenaltyReason): number | null {
    const key = `${aircraftId}:${reason}`;
    if (this.penalized.has(key)) return null;
    this.penalized.add(key);
    const points = PENALTY_POINTS[reason];
    this.score -= points;
    this.penaltyPoints += points;
    if (reason === 'diversion') this.diversions += 1;
    return points;
  }

  reset(): void {
    this.score = 0;
    this.completedFlights = 0;
    this.diversions = 0;
    this.penaltyPoints = 0;
    this.scored.clear();
    this.penalized.clear();
  }
}
