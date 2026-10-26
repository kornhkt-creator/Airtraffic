import type { Aircraft, Vec2 } from '../types';
import type { RouteManager } from '../airport/RouteManager';
import { SIM_CONFIG } from '../config';
import { clamp, cross, dot, fromAngle, sub } from '../math';

/**
 * Collision geometry (simplified game rule): every aircraft is a set of capsules in its own frame
 * (x forward, y left) matching the rendered model — fuselage, wing and tailplane. Two aircraft
 * collide when any of their capsules touch and their altitudes are within the vertical clearance.
 */
interface Capsule {
  a: Vec2;
  b: Vec2;
  radius: number;
}

const { wingspan } = SIM_CONFIG.aircraft;

export const FOOTPRINT: readonly Capsule[] = [
  { a: { x: 40, y: 0 }, b: { x: -42, y: 0 }, radius: 4.5 },
  { a: { x: 2, y: wingspan / 2 }, b: { x: 2, y: -wingspan / 2 }, radius: 6 },
  { a: { x: -37, y: 12 }, b: { x: -37, y: -12 }, radius: 3 },
];

/** Beyond this center distance two footprints can never touch (plus any warning buffer). */
const FOOTPRINT_REACH = 50;

/** Aircraft that still physically exist in the airspace or on the airport. */
export const isPhysical = (a: Aircraft): boolean => a.status !== 'DEPARTED' && a.status !== 'CRASHED';

function toWorld(ac: Aircraft, p: Vec2): Vec2 {
  const c = Math.cos(ac.heading);
  const s = Math.sin(ac.heading);
  return { x: ac.position.x + p.x * c - p.y * s, y: ac.position.y + p.x * s + p.y * c };
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / (dot(ab, ab) || 1), 0, 1);
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t));
}

function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const ab = sub(b, a);
  const cd = sub(d, c);
  const d1 = cross(ab, sub(c, a));
  const d2 = cross(ab, sub(d, a));
  const d3 = cross(cd, sub(a, c));
  const d4 = cross(cd, sub(b, c));
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/**
 * Smallest edge-to-edge distance between two aircraft footprints (negative when they overlap),
 * or Infinity when they are vertically separated or too far apart to matter.
 */
export function footprintGap(a: Aircraft, b: Aircraft): number {
  if (Math.abs(a.altitude - b.altitude) >= SIM_CONFIG.safety.verticalClearance) return Infinity;
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  if (Math.hypot(dx, dy) > FOOTPRINT_REACH * 2 + SIM_CONFIG.safety.conflictBuffer) return Infinity;
  let gap = Infinity;
  for (const ca of FOOTPRINT) {
    const a1 = toWorld(a, ca.a);
    const a2 = toWorld(a, ca.b);
    for (const cb of FOOTPRINT) {
      gap = Math.min(gap, segmentDistance(a1, a2, toWorld(b, cb.a), toWorld(b, cb.b)) - ca.radius - cb.radius);
    }
  }
  return gap;
}

export interface AircraftPair {
  a: Aircraft;
  b: Aircraft;
  gap: number;
}

/** Every pair of physical aircraft whose footprints are closer than `buffer` (0 = touching). */
export function findProximities(aircraft: readonly Aircraft[], buffer: number): AircraftPair[] {
  const live = aircraft.filter(isPhysical);
  const pairs: AircraftPair[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      const gap = footprintGap(a, b);
      if (gap < buffer) pairs.push({ a, b, gap });
    }
  }
  return pairs;
}

/** Aircraft that are actually touching. */
export const findCollisions = (aircraft: readonly Aircraft[]): AircraftPair[] => findProximities(aircraft, 0);

const isOnGround = (a: Aircraft): boolean => isPhysical(a) && a.altitude < 5;

/** True when `other` sits in `ac`'s forward corridor (ahead along its heading, within the lookahead). */
function aheadOf(ac: Aircraft, other: Aircraft, lookahead: number = SIM_CONFIG.safety.followLookahead): number | null {
  const { followCorridor } = SIM_CONFIG.safety;
  const dir = fromAngle(ac.heading);
  const rel = sub(other.position, ac.position);
  const along = dot(rel, dir);
  if (along <= 0 || along > lookahead || Math.abs(cross(dir, rel)) > followCorridor) return null;
  return along;
}

/** Spacing of the probe points along an aircraft's own route. */
const ROUTE_PROBE_STEP = 10;

/** Points along the aircraft's remaining route within the lookahead, with their route distance. */
function routeProbes(ac: Aircraft, lookahead: number): { d: number; p: Vec2 }[] {
  const path = ac.nav.path;
  if (!path) return [];
  const remaining = path.loop ? lookahead : Math.min(lookahead, path.length - ac.nav.s);
  const probes: { d: number; p: Vec2 }[] = [];
  for (let d = ROUTE_PROBE_STEP; d < remaining + ROUTE_PROBE_STEP; d += ROUTE_PROBE_STEP) {
    const along = Math.min(d, remaining);
    probes.push({ d: along, p: path.sample(ac.nav.s + along).position });
  }
  return probes;
}

/**
 * Route distance to the first point of `ac`'s own route that passes within the follow corridor of
 * `other`, or null. Following the route (not just the heading) lets taxiing aircraft see traffic
 * around corners, e.g. a departure waiting at the holding point at the end of a turn.
 */
function routeDistanceTo(ac: Aircraft, other: Aircraft, probes: readonly { d: number; p: Vec2 }[]): number | null {
  if (probes.length === 0) return aheadOf(ac, other);
  const { followCorridor } = SIM_CONFIG.safety;
  for (const { d, p } of probes) {
    if (Math.hypot(p.x - other.position.x, p.y - other.position.y) < followCorridor) return d;
  }
  return null;
}

/**
 * Simple ground follow logic (a safety aid, not a replacement for the controller): a taxiing
 * aircraft slows to keep its distance from ground traffic on its route ahead, which also makes
 * departures queue behind each other at a holding point. When two taxiing aircraft each find the
 * other on their route (crossing or head-on), the one with the lower id keeps going so they never
 * deadlock — head-on traffic therefore still collides, which is the controller's call to prevent.
 */
export function followSpeedCap(ac: Aircraft, aircraft: readonly Aircraft[]): number {
  const { followGap, followLookahead } = SIM_CONFIG.safety;
  const decel = SIM_CONFIG.ground.taxiDecel;
  const probes = routeProbes(ac, followLookahead);
  let cap = Infinity;
  for (const other of aircraft) {
    if (other === ac || !isOnGround(other)) continue;
    const along = routeDistanceTo(ac, other, probes);
    if (along === null) continue;
    const mutual = other.status === 'TAXIING' && !other.taxiHold && routeDistanceTo(other, ac, routeProbes(other, followLookahead)) !== null;
    if (mutual && ac.id < other.id) continue;
    cap = Math.min(cap, Math.sqrt(2 * decel * Math.max(0, along - followGap)));
  }
  return cap;
}

/** Airborne pairs that have lost the configured separation (warning, not a collision). */
export function findAirConflicts(aircraft: readonly Aircraft[]): AircraftPair[] {
  const { airHorizontal, airVertical, airMinAltitude } = SIM_CONFIG.safety;
  const airborne = aircraft.filter((a) => isPhysical(a) && a.altitude > airMinAltitude);
  const pairs: AircraftPair[] = [];
  for (let i = 0; i < airborne.length; i++) {
    for (let j = i + 1; j < airborne.length; j++) {
      const a = airborne[i]!;
      const b = airborne[j]!;
      const horizontal = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
      if (horizontal < airHorizontal && Math.abs(a.altitude - b.altitude) < airVertical) pairs.push({ a, b, gap: horizontal });
    }
  }
  return pairs;
}

interface RouteEdgeAhead {
  from: string;
  to: string;
  /** Route distance from the aircraft to the start of this edge (0 for the edge it is on). */
  distance: number;
}

/**
 * The directed taxi-route edges an aircraft still has to travel: the edge it is on and the rest of
 * its route, including a route queued behind a rollout or pushback.
 */
export function remainingRouteEdges(ac: Aircraft, routes: RouteManager): RouteEdgeAhead[] {
  const queued = ac.pendingRoute !== null && (ac.status === 'LANDED' || ac.status === 'PUSHBACK');
  const route = queued ? ac.pendingRoute! : ac.status === 'TAXIING' ? ac.routeNodeIds : [];
  if (route.length < 2) return [];
  const pts = routes.positions(route);
  // The edge the aircraft is on is the route segment closest to it (routes never overlap themselves).
  let current = 0;
  let best = Infinity;
  if (!queued) {
    for (let i = 0; i < pts.length - 1; i++) {
      const d = pointSegmentDistance(ac.position, pts[i]!, pts[i + 1]!);
      if (d < best) {
        best = d;
        current = i;
      }
    }
  }
  const edges: RouteEdgeAhead[] = [];
  let distance = queued ? Math.hypot(ac.position.x - pts[0]!.x, ac.position.y - pts[0]!.y) : 0;
  for (let i = current; i < pts.length - 1; i++) {
    edges.push({ from: route[i]!, to: route[i + 1]!, distance });
    const a = i === current && !queued ? ac.position : pts[i]!;
    distance += Math.hypot(pts[i + 1]!.x - a.x, pts[i + 1]!.y - a.y);
  }
  return edges;
}

/**
 * Ground traffic cleared along the same taxiway segment in opposite directions within the route
 * lookahead. Nobody can reverse on a taxiway, so this predicts a head-on meeting well before the
 * aircraft see each other — the controller has to hold one of them clear of that segment.
 */
export function findRouteConflicts(aircraft: readonly Aircraft[], routes: RouteManager): AircraftPair[] {
  const { headOnRouteLookahead } = SIM_CONFIG.safety;
  const planned = aircraft
    .filter((a) => isOnGround(a))
    .map((a) => ({ a, edges: remainingRouteEdges(a, routes).filter((e) => e.distance < headOnRouteLookahead) }))
    .filter((x) => x.edges.length > 0);
  const pairs: AircraftPair[] = [];
  for (let i = 0; i < planned.length; i++) {
    for (let j = i + 1; j < planned.length; j++) {
      const p = planned[i]!;
      const q = planned[j]!;
      const meet = p.edges.find((e) => q.edges.some((f) => f.from === e.to && f.to === e.from));
      if (meet) pairs.push({ a: p.a, b: q.a, gap: meet.distance });
    }
  }
  return pairs;
}

/**
 * Taxiing aircraft heading straight at each other on the same taxiway. Nobody can reverse on a
 * taxiway, so unless the controller holds one of them short, this ends in a collision.
 */
export function findHeadOn(aircraft: readonly Aircraft[]): AircraftPair[] {
  const { headOnLookahead } = SIM_CONFIG.safety;
  const moving = aircraft.filter((a) => a.status === 'TAXIING' && a.speed > 0.5);
  const pairs: AircraftPair[] = [];
  for (let i = 0; i < moving.length; i++) {
    for (let j = i + 1; j < moving.length; j++) {
      const a = moving[i]!;
      const b = moving[j]!;
      if (dot(fromAngle(a.heading), fromAngle(b.heading)) > -0.7) continue;
      const along = aheadOf(a, b, headOnLookahead);
      if (along !== null && aheadOf(b, a, headOnLookahead) !== null) pairs.push({ a, b, gap: along });
    }
  }
  return pairs;
}
