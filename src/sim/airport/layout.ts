import type { Vec2 } from '../types';

/**
 * AIRPORT COORDINATE SYSTEM
 * - Origin (0, 0) is the center of the terminal complex, midway between the two runways.
 * - x points east, y points north, units are meters. Altitude is meters above field elevation.
 * - Headings are math angles (radians, 0 = east, counter-clockwise). Runways 01L/01R have heading +PI/2.
 * - The renderer maps sim (x, y, alt) to Three.js (x, alt, -y).
 *
 * The layout is modelled on Suvarnabhumi (BKK): two parallel north-south runways with the terminal
 * between them. Operations are segregated (simplified game rule): arrivals land northbound on the
 * west runway 01L, departures take off northbound from the east runway 01R. The concourse spine and
 * main terminal sit at the north end of the complex, two long piers (C and F) reach south from it,
 * and a satellite concourse lies further south.
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
  /** Designator in the direction in use first, the reciprocal second. */
  readonly designators: readonly [string, string];
  /** Threshold of the direction in use. */
  readonly start: Vec2;
  /** Far end of the direction in use. */
  readonly end: Vec2;
  readonly heading: number;
  readonly length: number;
  readonly width: number;
  readonly touchdown: Vec2;
  /** Exits in landing order (empty for the departure runway). */
  readonly exits: readonly RunwayExit[];
}

export interface ApproachDef {
  /** Final approach fix: aircraft are aligned with the arrival runway from here. */
  readonly faf: Vec2;
  readonly holdingCenter: Vec2;
  readonly holdingStraight: number;
  readonly holdingRadius: number;
}

/** A parked aircraft that is scenery only (remote stands, satellite, center pier). */
export interface StaticStand {
  readonly position: Vec2;
  readonly heading: number;
}

export interface AirportLayout {
  readonly name: string;
  /** Runway used by arrivals (landing). */
  readonly arrivalRunway: RunwayDef;
  /** Runway used by departures (takeoff). */
  readonly departureRunway: RunwayDef;
  readonly approach: ApproachDef;
  readonly nodes: readonly TaxiNode[];
  readonly edges: readonly TaxiEdge[];
  readonly gateIds: readonly string[];
  readonly holdingPointIds: readonly string[];
  /** Distance of the hold-short line from the runway centerline. */
  readonly holdShortOffset: number;
  readonly staticStands: readonly StaticStand[];
}

const node = (id: string, kind: NodeKind, x: number, y: number, label?: string): TaxiNode =>
  label === undefined ? { id, kind, position: { x, y } } : { id, kind, position: { x, y }, label };

const edge = (from: string, to: string, kind: EdgeKind, name: string): TaxiEdge => ({ from, to, kind, name });

const NORTH = Math.PI / 2;

/**
 * East-west positions (sim x, meters) of the north-south features. Spacing is sized for the game's
 * enlarged aircraft (see SIM_CONFIG.aircraft): noses and tails stay behind hold-short lines, and
 * parked tails clear the apron lanes.
 */
export const LAYOUT_X = {
  /** Arrival runway 01L centerline (west). */
  arrivalRunway: -850,
  /** Departure runway 01R centerline (east). */
  departureRunway: 850,
  /** Parallel taxiways: A (west) and B (east). */
  taxiwayA: -620,
  taxiwayB: 620,
  /** Exit / holding nodes just clear of the hold-short lines. */
  exitA: -725,
  holdB: 725,
  /** Piers C (west) and F (east) centerlines; half width 15 m. */
  pierC: -330,
  pierF: 330,
  /** Apron lanes either side of each pier. */
  laneCOuter: -495,
  laneCInner: -165,
  laneFInner: 165,
  laneFOuter: 495,
} as const;

/** North-south positions (sim y, meters) of the east-west features. */
export const LAYOUT_Y = {
  runwaySouth: -900,
  runwayNorth: 900,
  /** Cross taxiway J (north, outer lanes to the parallels). */
  taxiwayJ: 300,
  /** Cross taxiway K (south of the piers). */
  taxiwayK: -300,
  /** Cross taxiway L (south of the satellite). */
  taxiwayL: -630,
  /** Concourse spine south face; the main terminal lies north of it. */
  spine: 350,
  /** Pier tips (south end). */
  pierTip: -170,
  /** Satellite concourse centerline. */
  satellite: -465,
} as const;

const X = LAYOUT_X;
const Y = LAYOUT_Y;

/** Gate stand rows along the piers (sim y). */
const GATE_ROWS = [230, 130, 30, -70] as const;
/** Parked aircraft stand 60 m from the pier centerline (nose under the jet bridge). */
const STAND_OFFSET = 60;

interface PierSide {
  pier: 'C' | 'F';
  lane: number;
  /** Stand x position. */
  standX: number;
  laneId: string;
  firstGate: number;
}

const PIER_SIDES: PierSide[] = [
  { pier: 'C', lane: X.laneCOuter, standX: X.pierC - STAND_OFFSET, laneId: 'CO', firstGate: 1 },
  { pier: 'C', lane: X.laneCInner, standX: X.pierC + STAND_OFFSET, laneId: 'CI', firstGate: 5 },
  { pier: 'F', lane: X.laneFInner, standX: X.pierF - STAND_OFFSET, laneId: 'FI', firstGate: 1 },
  { pier: 'F', lane: X.laneFOuter, standX: X.pierF + STAND_OFFSET, laneId: 'FO', firstGate: 5 },
];

function buildLayout(): AirportLayout {
  const nodes: TaxiNode[] = [];
  const edges: TaxiEdge[] = [];
  const gateIds: string[] = [];

  // ---- Arrival runway 01L (west) and its exits onto taxiway A
  const exitYs = [-200, 150, 500, 900];
  nodes.push(node('RA0', 'runway', X.arrivalRunway, Y.runwaySouth));
  exitYs.forEach((y, i) => {
    const n = i + 1;
    nodes.push(node(`RA${n}`, 'runway', X.arrivalRunway, y));
    nodes.push(node(`X${n}`, 'exit', X.exitA, y, `Exit A${n}`));
    edges.push(edge(i === 0 ? 'RA0' : `RA${i}`, `RA${n}`, 'runway', 'RWY 01L'));
    edges.push(edge(`RA${n}`, `X${n}`, 'runwayConnector', `A${n}`));
  });

  // ---- Taxiway A (west parallel), south to north
  const taxiwayA: [string, number][] = [
    ['AL', Y.taxiwayL],
    ['AK', Y.taxiwayK],
    ['A1', exitYs[0]!],
    ['A2', exitYs[1]!],
    ['AJ', Y.taxiwayJ],
    ['A3', exitYs[2]!],
    ['A4', exitYs[3]!],
  ];
  for (const [id, y] of taxiwayA) nodes.push(node(id, 'taxiway', X.taxiwayA, y));
  for (let i = 1; i < taxiwayA.length; i++) edges.push(edge(taxiwayA[i - 1]![0], taxiwayA[i]![0], 'taxiway', 'A'));
  exitYs.forEach((_, i) => edges.push(edge(`X${i + 1}`, `A${i + 1}`, 'taxiway', `A${i + 1}`)));

  // ---- Departure runway 01R (east), holding points B1 (full length) and B2 (intersection)
  nodes.push(
    node('RB0', 'runway', X.departureRunway, Y.runwaySouth),
    node('RB1', 'runway', X.departureRunway, -500),
    node('RB2', 'runway', X.departureRunway, Y.runwayNorth),
    node('H1', 'holdingPoint', X.holdB, Y.runwaySouth, 'Holding point B1'),
    node('H2', 'holdingPoint', X.holdB, -500, 'Holding point B2'),
  );
  edges.push(
    edge('RB0', 'RB1', 'runway', 'RWY 01R'),
    edge('RB1', 'RB2', 'runway', 'RWY 01R'),
    edge('RB0', 'H1', 'runwayConnector', 'B1'),
    edge('RB1', 'H2', 'runwayConnector', 'B2'),
  );

  // ---- Taxiway B (east parallel), south to north
  const taxiwayB: [string, number][] = [
    ['B1', Y.runwaySouth],
    ['BL', Y.taxiwayL],
    ['B2', -500],
    ['BK', Y.taxiwayK],
    ['BJ', Y.taxiwayJ],
  ];
  for (const [id, y] of taxiwayB) nodes.push(node(id, 'taxiway', X.taxiwayB, y));
  for (let i = 1; i < taxiwayB.length; i++) edges.push(edge(taxiwayB[i - 1]![0], taxiwayB[i]![0], 'taxiway', 'B'));
  edges.push(edge('H1', 'B1', 'taxiway', 'B1'), edge('H2', 'B2', 'taxiway', 'B2'));

  // ---- Cross taxiways
  nodes.push(node('LM', 'taxiway', 0, Y.taxiwayL));
  edges.push(edge('AL', 'LM', 'taxiway', 'L'), edge('LM', 'BL', 'taxiway', 'L'));
  const kChain = ['AK', 'COK', 'CIK', 'FIK', 'FOK', 'BK'];
  for (let i = 1; i < kChain.length; i++) edges.push(edge(kChain[i - 1]!, kChain[i]!, 'taxiway', 'K'));
  edges.push(edge('AJ', 'COJ', 'taxiway', 'J'), edge('FOJ', 'BJ', 'taxiway', 'J'));

  // ---- Pier apron lanes and gates
  for (const side of PIER_SIDES) {
    const { laneId, lane } = side;
    nodes.push(node(`${laneId}K`, 'apron', lane, Y.taxiwayK));
    const chain = [`${laneId}K`];
    // Rows south to north so the lane runs up from taxiway K.
    [...GATE_ROWS].reverse().forEach((y) => {
      const id = `${laneId}${y}`;
      nodes.push(node(id, 'apron', lane, y));
      chain.push(id);
    });
    // Outer lanes continue north to taxiway J; inner lanes end under the spine.
    if (laneId === 'CO' || laneId === 'FO') {
      nodes.push(node(`${laneId}J`, 'apron', lane, Y.taxiwayJ));
      chain.push(`${laneId}J`);
    }
    for (let i = 1; i < chain.length; i++) edges.push(edge(chain[i - 1]!, chain[i]!, 'apron', `Apron ${side.pier}`));

    GATE_ROWS.forEach((y, k) => {
      const number = side.firstGate + k;
      const gateId = `G${side.pier === 'C' ? number : number + 8}`;
      nodes.push(node(gateId, 'gate', side.standX, y, `Gate ${side.pier}${number}`));
      edges.push(edge(`${laneId}${y}`, gateId, 'stand', `Stand ${side.pier}${number}`));
      gateIds.push(gateId);
    });
  }
  gateIds.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

  const arrivalRunway: RunwayDef = {
    id: '01L/19R',
    designators: ['01L', '19R'],
    start: { x: X.arrivalRunway, y: Y.runwaySouth },
    end: { x: X.arrivalRunway, y: Y.runwayNorth },
    heading: NORTH,
    length: Y.runwayNorth - Y.runwaySouth,
    width: 60,
    touchdown: { x: X.arrivalRunway, y: Y.runwaySouth + 120 },
    exits: exitYs.map((_, i) => ({ runwayNodeId: `RA${i + 1}`, exitNodeId: `X${i + 1}`, name: `A${i + 1}` })),
  };

  const departureRunway: RunwayDef = {
    id: '01R/19L',
    designators: ['01R', '19L'],
    start: { x: X.departureRunway, y: Y.runwaySouth },
    end: { x: X.departureRunway, y: Y.runwayNorth },
    heading: NORTH,
    length: Y.runwayNorth - Y.runwaySouth,
    width: 60,
    touchdown: { x: X.departureRunway, y: Y.runwaySouth + 120 },
    exits: [],
  };

  // Scenery: parked aircraft on the center pier, the satellite, the pier north arms and remote stands.
  const staticStands: StaticStand[] = [
    ...[250, 150].flatMap((y) => [
      { position: { x: -STAND_OFFSET, y }, heading: 0 },
      { position: { x: STAND_OFFSET, y }, heading: Math.PI },
    ]),
    ...[-250, -150, -50, 50, 150, 250].flatMap((x) => [
      { position: { x, y: Y.satellite + STAND_OFFSET }, heading: -NORTH },
      { position: { x, y: Y.satellite - STAND_OFFSET }, heading: NORTH },
    ]),
    ...[470, 570].flatMap((y) => [
      { position: { x: X.pierC - STAND_OFFSET, y }, heading: 0 },
      { position: { x: X.pierF + STAND_OFFSET, y }, heading: Math.PI },
    ]),
    ...[-360, -240, -120, 0, 120, 240, 360].map((x) => ({ position: { x, y: -740 }, heading: NORTH })),
  ];

  return {
    name: 'Suvarnabhumi International',
    arrivalRunway,
    departureRunway,
    approach: {
      faf: { x: X.arrivalRunway, y: Y.runwaySouth - 550 },
      holdingCenter: { x: -1800, y: -150 },
      holdingStraight: 700,
      holdingRadius: 280,
    },
    nodes,
    edges,
    gateIds,
    holdingPointIds: ['H1', 'H2'],
    holdShortOffset: 80,
    staticStands,
  };
}

export const AIRPORT: AirportLayout = buildLayout();
