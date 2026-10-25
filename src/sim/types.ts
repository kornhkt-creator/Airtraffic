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

export type NavKind = 'none' | 'holding' | 'approach' | 'rollout' | 'taxi';

export interface NavState {
  path: Path | null;
  /** Distance travelled along the path in meters. */
  s: number;
  /** Speed the aircraft should have when it reaches the end of the path. */
  endSpeed: number;
  kind: NavKind;
  /** Incremented every time a new path is assigned (used by renderers to rebuild route lines). */
  version: number;
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
  onRunway: boolean;
  /** Seconds spent waiting for a controller instruction. */
  waitTime: number;
}

export type Command =
  | { type: 'LAND'; aircraftId: string }
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
  | { type: 'FLIGHT_COMPLETED'; aircraftId: string };
