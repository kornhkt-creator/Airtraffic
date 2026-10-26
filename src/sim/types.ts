import type { Path } from './path/Path';

/**
 * Simulation coordinate system (see airport/layout.ts):
 *   x = east (meters), y = north (meters), altitude = meters above ground.
 *   Headings are math angles in radians: 0 = east, +PI/2 = north (counter-clockwise).
 */
export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  alt: number;
}

export type FlightType = 'ARRIVAL' | 'DEPARTURE';

export const AIRCRAFT_STATUSES = [
  'APPROACH',
  'LANDING',
  'GO_AROUND',
  'LANDED',
  'TAXIING',
  'HOLDING',
  'AT_GATE',
  'PUSHBACK',
  'LINE_UP',
  'TAKEOFF',
  'DEPARTED',
  'DIVERTED',
  'CRASHED',
] as const;

export type AircraftStatus = (typeof AIRCRAFT_STATUSES)[number];

export type GameStatus = 'MENU' | 'RUNNING' | 'PAUSED' | 'GAME_OVER';

export type NavKind = 'none' | 'inbound' | 'holding' | 'approach' | 'goaround' | 'rollout' | 'taxi' | 'pushback' | 'lineup' | 'takeoff' | 'divert';

export interface NavState {
  path: Path | null;
  /** Distance travelled along the path in meters. */
  s: number;
  /** Speed the aircraft should have when it reaches the end of the path. */
  endSpeed: number;
  kind: NavKind;
  /** True while moving tail-first along the path (pushback). */
  reverse: boolean;
  /** Incremented every time a new path is assigned (used by renderers to rebuild route lines). */
  version: number;
}

export interface PushbackInfo {
  /** Apron node the aircraft was pushed onto; its taxi route starts here. */
  apronNodeId: string;
  /** Where the pushback ends (the aircraft then faces toward apronNodeId). */
  endPoint: Vec2;
}

export interface KinematicState {
  position: Vec2;
  altitude: number;
  heading: number;
}

export interface Aircraft {
  readonly id: string;
  readonly callsign: string;
  readonly flightType: FlightType;
  status: AircraftStatus;
  position: Vec2;
  altitude: number;
  heading: number;
  /** Ground/air speed in m/s. */
  speed: number;
  /** State at the start of the latest tick, used for render interpolation. */
  prev: KinematicState;
  nav: NavState;
  /** Node ids of the active ground route. */
  routeNodeIds: string[];
  /** Ground route assigned while still rolling out; started once the runway is vacated. */
  pendingRoute: string[] | null;
  /** Node where the landing rollout leaves the runway. */
  exitNodeId: string | null;
  /** Gate or holding point this aircraft is taxiing to (reserved). */
  destinationId: string | null;
  /** Gate the aircraft is parked at. */
  gateId: string | null;
  /** Holding point the aircraft is waiting at. */
  holdingPointId: string | null;
  pushback: PushbackInfo | null;
  onRunway: boolean;
  /** Seconds spent waiting for a controller instruction. */
  waitTime: number;
  /** Index into the holding stack levels while holding or inbound (null otherwise). */
  holdingLevel: number | null;
  /** True once the low-fuel diversion warning has been issued. */
  divertWarned: boolean;
  /** Seconds parked at the gate (drives the arrival → departure turnaround). */
  gateTime: number;
  /** True while another aircraft's footprint is dangerously close (conflict warning). */
  conflict: boolean;
  /** Controller told this taxiing aircraft to hold position. */
  taxiHold: boolean;
  /** Delay penalties already charged for the current wait (resets when the wait does). */
  delayPenalties: number;
  /** Runway this aircraft was cleared for (null = its flight type's default runway). */
  runwayId: string | null;
}

/** Why a game ended. */
export type GameEndReason = 'collision' | 'shift-ended';

/** The collision that ended the game. */
export interface CrashInfo {
  aircraftIds: [string, string];
  callsigns: [string, string];
  /** Midpoint between the two aircraft. */
  position: Vec2;
  altitude: number;
  time: number;
}

/** Commands that need no parameter besides the aircraft. */
export type SimpleCommandType = 'LAND' | 'GO_AROUND' | 'PUSHBACK' | 'LINE_UP' | 'TAKEOFF' | 'HOLD' | 'CONTINUE';

export type Command =
  | { type: Exclude<SimpleCommandType, 'LAND'>; aircraftId: string }
  /** Landing clearance; `runwayId` picks the runway (default: the arrival runway). */
  | { type: 'LAND'; aircraftId: string; runwayId?: string }
  | { type: 'TAXI'; aircraftId: string; destinationId: string };

export type CommandType = Command['type'];

export interface CommandResult {
  ok: boolean;
  message: string;
}

export type AlertSeverity = 'info' | 'success' | 'warning' | 'critical';

export interface Alert {
  id: number;
  severity: AlertSeverity;
  message: string;
  time: number;
  expiresAt: number | null;
  aircraftId: string | null;
}

export type SimEvent =
  | { type: 'STATUS_CHANGED'; aircraftId: string; from: AircraftStatus; to: AircraftStatus }
  | { type: 'RUNWAY_VACATED'; aircraftId: string }
  | { type: 'PUSHBACK_COMPLETED'; aircraftId: string }
  | { type: 'FLIGHT_COMPLETED'; aircraftId: string }
  | { type: 'DIVERT_WARNING'; aircraftId: string; secondsLeft: number }
  | { type: 'FLIGHT_DIVERTED'; aircraftId: string };
