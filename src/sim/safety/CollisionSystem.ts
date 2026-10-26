import type { Aircraft, Vec2 } from '../types';
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

/**
 * Simple ground follow logic (a safety aid, not a replacement for the controller): a taxiing
 * aircraft slows to keep its distance from ground traffic ahead. When two taxiing aircraft each
 * see the other ahead (crossing or head-on), the one with the lower id keeps going so they never
 * deadlock — head-on traffic therefore still collides, which is the controller's call to prevent.
 */
export function followSpeedCap(ac: Aircraft, aircraft: readonly Aircraft[]): number {
  const { followGap } = SIM_CONFIG.safety;
  const decel = SIM_CONFIG.ground.taxiDecel;
  let cap = Infinity;
  for (const other of aircraft) {
    if (other === ac || !isOnGround(other)) continue;
    const along = aheadOf(ac, other);
    if (along === null) continue;
    const mutual = other.status === 'TAXIING' && !other.taxiHold && aheadOf(other, ac) !== null;
    if (mutual && ac.id < other.id) continue;
    cap = Math.min(cap, Math.sqrt(2 * decel * Math.max(0, along - followGap)));
  }
  return cap;
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
