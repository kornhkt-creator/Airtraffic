import type { AircraftStatus, Alert, FlightType, GameStatus } from './types';
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
  commands: CommandOption[];
}

export interface SimSnapshot {
  status: GameStatus;
  time: number;
  timeScale: number;
  score: number;
  completedFlights: number;
  activeFlights: number;
  aircraft: AircraftView[];
  alerts: Alert[];
  runwayOccupiedBy: string[];
}
