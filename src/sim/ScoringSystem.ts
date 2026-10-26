import { SIM_CONFIG } from './config';
import type { FlightType } from './types';

export type PenaltyReason = 'diversion' | 'goAround' | 'delay' | 'incursion' | 'conflict';

export const PENALTY_REASONS: readonly PenaltyReason[] = ['diversion', 'goAround', 'delay', 'incursion', 'conflict'];

const PENALTY_POINTS: Record<PenaltyReason, number> = {
  diversion: SIM_CONFIG.scoring.diversionPenalty,
  goAround: SIM_CONFIG.scoring.goAroundPenalty,
  delay: SIM_CONFIG.scoring.delayPenalty,
  incursion: SIM_CONFIG.scoring.incursionPenalty,
  conflict: SIM_CONFIG.scoring.conflictPenalty,
};

const emptyCounts = (): Record<PenaltyReason, number> => ({ diversion: 0, goAround: 0, delay: 0, incursion: 0, conflict: 0 });

/**
 * Awards points once per flight and deducts penalties once per occurrence; repeated events for the
 * same flight (or the same occurrence) are ignored.
 */
export class ScoringSystem {
  score = 0;
  completedFlights = 0;
  completedArrivals = 0;
  completedDepartures = 0;
  penaltyPoints = 0;
  /** How many times each penalty was applied. */
  penaltyCounts = emptyCounts();
  private readonly scored = new Set<string>();
  private readonly penalized = new Set<string>();

  get diversions(): number {
    return this.penaltyCounts.diversion;
  }

  /** Returns the points awarded, or null if this flight was already scored. */
  recordCompletion(aircraftId: string, flightType: FlightType = 'ARRIVAL'): number | null {
    if (this.scored.has(aircraftId)) return null;
    this.scored.add(aircraftId);
    const points = flightType === 'ARRIVAL' ? SIM_CONFIG.scoring.arrivalCompleted : SIM_CONFIG.scoring.departureCompleted;
    this.score += points;
    this.completedFlights += 1;
    if (flightType === 'ARRIVAL') this.completedArrivals += 1;
    else this.completedDepartures += 1;
    return points;
  }

  /**
   * Deducts a penalty once per (subject, reason, occurrence). `subject` is a flight id or a pair key;
   * `occurrence` distinguishes repeatable penalties (each go-around, each extra minute of delay).
   * Returns the points deducted, or null if this occurrence was already penalized.
   */
  recordPenalty(subject: string, reason: PenaltyReason, occurrence = ''): number | null {
    const key = `${subject}:${reason}:${occurrence}`;
    if (this.penalized.has(key)) return null;
    this.penalized.add(key);
    const points = PENALTY_POINTS[reason];
    this.score -= points;
    this.penaltyPoints += points;
    this.penaltyCounts[reason] += 1;
    return points;
  }

  reset(): void {
    this.score = 0;
    this.completedFlights = 0;
    this.completedArrivals = 0;
    this.completedDepartures = 0;
    this.penaltyPoints = 0;
    this.penaltyCounts = emptyCounts();
    this.scored.clear();
    this.penalized.clear();
  }
}
