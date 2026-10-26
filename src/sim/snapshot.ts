import type { AircraftStatus, Alert, CrashInfo, FlightType, GameEndReason, GameStatus } from './types';
import type { PenaltyReason } from './ScoringSystem';
import type { CommandOption } from './CommandSystem';

/** Plain, serializable view of an aircraft for the UI. */
export interface AircraftView {
  id: string;
  callsign: string;
  flightType: FlightType;
  status: AircraftStatus;
  speedKt: number;
  altitudeFt: number;
  headingDeg: number;
  target: string;
  waitTime: number;
  pathVersion: number;
  onRunway: boolean;
  /** Holding stack level (0 = bottom) for inbound/holding arrivals. */
  holdingLevel: number | null;
  /** Seconds until a holding arrival diverts, or null when not holding. */
  divertIn: number | null;
  /** Another aircraft is dangerously close. */
  conflict: boolean;
  commands: CommandOption[];
}

export interface SimSnapshot {
  status: GameStatus;
  time: number;
  timeScale: number;
  score: number;
  completedFlights: number;
  diversions: number;
  difficultyLevel: number;
  activeFlights: number;
  aircraft: AircraftView[];
  alerts: Alert[];
  runways: RunwayView[];
  /** The collision that ended the game, if any. */
  crash: CrashInfo | null;
  /** Why the game ended (null while it is running). */
  endReason: GameEndReason | null;
  summary: MissionSummary;
}

/** Mission statistics shown on the end screen. */
export interface MissionSummary {
  score: number;
  /** Sim seconds played. */
  duration: number;
  difficultyLevel: number;
  completedArrivals: number;
  completedDepartures: number;
  penaltyPoints: number;
  /** How many times each penalty was applied. */
  penalties: Record<PenaltyReason, number>;
}

export interface RunwayView {
  /** Designator in use, e.g. "01L". */
  designator: string;
  use: 'ARRIVALS' | 'DEPARTURES';
  /** Callsigns of the aircraft occupying the runway. */
  occupiedBy: string[];
}
