import { SIM_CONFIG } from './config';

/** Awards points once per flight; repeated completion events for the same flight are ignored. */
export class ScoringSystem {
  score = 0;
  completedFlights = 0;
  private readonly scored = new Set<string>();

  /** Returns the points awarded, or null if this flight was already scored. */
  recordCompletion(aircraftId: string): number | null {
    if (this.scored.has(aircraftId)) return null;
    this.scored.add(aircraftId);
    const points = SIM_CONFIG.scoring.arrivalCompleted;
    this.score += points;
    this.completedFlights += 1;
    return points;
  }

  reset(): void {
    this.score = 0;
    this.completedFlights = 0;
    this.scored.clear();
  }
}
