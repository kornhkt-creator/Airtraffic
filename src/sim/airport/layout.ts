import type { Vec2 } from '../types';

/**
 * AIRPORT COORDINATE SYSTEM
 * - Origin (0, 0) is the center of runway 09/27.
 * - x points east, y points north, units are meters. Altitude is meters above field elevation.
 * - Headings are math angles (radians, 0 = east, counter-clockwise). Runway 09 has heading 0.
 * - The renderer maps sim (x, y, alt) to Three.js (x, alt, -y).
 *
 * Operations in the MVP use runway 09 only: arrivals land eastbound, departures take off eastbound.
 * The parallel taxiway A runs 180 m south of the runway; the apron and gates lie south of it.
 */

export type NodeKind = 'runway' | 'holdingPoint' | 'exit' | 'taxiway' | 'apron' | 'gate';
export type EdgeKind = 'runway' | 'runwayConnector' | 'taxiway' | 'apron' | 'stand';

export interface TaxiNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly position: Vec2;
  readonly label?: string;
}

export interface TaxiEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  /** Taxiway name shown in clearances. */
  readonly name: string;
}

export interface RunwayExit {
  /** Node on the runway centerline where the exit turn begins. */
  readonly runwayNodeId: string;
  /** First node clear of the runway (beyond the hold-short line). */
  readonly exitNodeId: string;
  readonly name: string;
}

export interface RunwayDef {
  readonly id: string;
  readonly designators: readonly [string, string];
  /** West threshold (runway 09 threshold). */
  readonly start: Vec2;
  readonly end: Vec2;
  readonly heading: number;
  readonly length: number;
  readonly width: number;
  readonly touchdown: Vec2;
  /** Exits in landing order (west to east). */
  readonly exits: readonly RunwayExit[];
}

export interface ApproachDef {
  /** Final approach fix: aircraft are aligned with the runway from here. */
  readonly faf: Vec2;
  readonly holdingCenter: Vec2;
  readonly holdingStraight: number;
  readonly holdingRadius: number;
}

export interface AirportLayout {
  readonly name: string;
  readonly runway: RunwayDef;
  readonly approach: ApproachDef;
  readonly nodes: readonly TaxiNode[];
  readonly edges: readonly TaxiEdge[];
  readonly gateIds: readonly string[];
  readonly holdingPointIds: readonly string[];
  /** Distance of the hold-short line from the runway centerline. */
  readonly holdShortOffset: number;
}

const node = (id: string, kind: NodeKind, x: number, y: number, label?: string): TaxiNode =>
  label === undefined ? { id, kind, position: { x, y } } : { id, kind, position: { x, y }, label };

const edge = (from: string, to: string, kind: EdgeKind, name: string): TaxiEdge => ({ from, to, kind, name });

const TAXIWAY_Y = -180;
const EXIT_Y = -100;
const APRON_Y = -280;
const GATE_Y = -360;

export const AIRPORT: AirportLayout = {
  name: 'Northfield Regional',
  runway: {
    id: '09/27',
    designators: ['09', '27'],
    start: { x: -1000, y: 0 },
    end: { x: 1000, y: 0 },
    heading: 0,
    length: 2000,
    width: 45,
    touchdown: { x: -850, y: 0 },
    exits: [
      { runwayNodeId: 'R2', exitNodeId: 'X2', name: 'A2' },
      { runwayNodeId: 'R3', exitNodeId: 'X3', name: 'A3' },
      { runwayNodeId: 'R4', exitNodeId: 'X4', name: 'A4' },
    ],
  },
  approach: {
    faf: { x: -4000, y: 0 },
    holdingCenter: { x: -3300, y: 1900 },
    holdingStraight: 1800,
    holdingRadius: 600,
  },
  nodes: [
    node('R1', 'runway', -1000, 0),
    node('R2', 'runway', 0, 0),
    node('R3', 'runway', 500, 0),
    node('R4', 'runway', 1000, 0),
    node('H1', 'holdingPoint', -1000, EXIT_Y, 'Holding point A1'),
    node('X2', 'exit', 0, EXIT_Y, 'Exit A2'),
    node('X3', 'exit', 500, EXIT_Y, 'Exit A3'),
    node('X4', 'exit', 1000, EXIT_Y, 'Exit A4'),
    node('T1', 'taxiway', -1000, TAXIWAY_Y),
    node('TW', 'taxiway', -200, TAXIWAY_Y),
    node('T2', 'taxiway', 0, TAXIWAY_Y),
    node('TE', 'taxiway', 200, TAXIWAY_Y),
    node('T3', 'taxiway', 500, TAXIWAY_Y),
    node('T4', 'taxiway', 1000, TAXIWAY_Y),
    node('P1', 'apron', -300, APRON_Y),
    node('PW', 'apron', -200, APRON_Y),
    node('P2', 'apron', -100, APRON_Y),
    node('P3', 'apron', 100, APRON_Y),
    node('PE', 'apron', 200, APRON_Y),
    node('P4', 'apron', 300, APRON_Y),
    node('G1', 'gate', -300, GATE_Y, 'Gate 1'),
    node('G2', 'gate', -100, GATE_Y, 'Gate 2'),
    node('G3', 'gate', 100, GATE_Y, 'Gate 3'),
    node('G4', 'gate', 300, GATE_Y, 'Gate 4'),
  ],
  edges: [
    edge('R1', 'R2', 'runway', 'RWY 09/27'),
    edge('R2', 'R3', 'runway', 'RWY 09/27'),
    edge('R3', 'R4', 'runway', 'RWY 09/27'),
    edge('R1', 'H1', 'runwayConnector', 'A1'),
    edge('R2', 'X2', 'runwayConnector', 'A2'),
    edge('R3', 'X3', 'runwayConnector', 'A3'),
    edge('R4', 'X4', 'runwayConnector', 'A4'),
    edge('H1', 'T1', 'taxiway', 'A1'),
    edge('X2', 'T2', 'taxiway', 'A2'),
    edge('X3', 'T3', 'taxiway', 'A3'),
    edge('X4', 'T4', 'taxiway', 'A4'),
    edge('T1', 'TW', 'taxiway', 'A'),
    edge('TW', 'T2', 'taxiway', 'A'),
    edge('T2', 'TE', 'taxiway', 'A'),
    edge('TE', 'T3', 'taxiway', 'A'),
    edge('T3', 'T4', 'taxiway', 'A'),
    edge('TW', 'PW', 'taxiway', 'B'),
    edge('TE', 'PE', 'taxiway', 'C'),
    edge('P1', 'PW', 'apron', 'Apron'),
    edge('PW', 'P2', 'apron', 'Apron'),
    edge('P2', 'P3', 'apron', 'Apron'),
    edge('P3', 'PE', 'apron', 'Apron'),
    edge('PE', 'P4', 'apron', 'Apron'),
    edge('P1', 'G1', 'stand', 'Stand 1'),
    edge('P2', 'G2', 'stand', 'Stand 2'),
    edge('P3', 'G3', 'stand', 'Stand 3'),
    edge('P4', 'G4', 'stand', 'Stand 4'),
  ],
  gateIds: ['G1', 'G2', 'G3', 'G4'],
  holdingPointIds: ['H1'],
  holdShortOffset: 75,
};
