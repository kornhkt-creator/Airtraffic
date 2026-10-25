import type { Vec2 } from '../types';
import { add, clamp, cross, distance, dot, leftNormal, normalize, scale, sub } from '../math';
import { arcSegment, lineSegment, Path, type PathMotion, type PathSegment } from './Path';

export interface FilletOptions {
  /** Preferred turn radius at every corner (reduced automatically when segments are short). */
  filletRadius: number;
  /** Max speed for each polyline edge (length = points.length - 1), or one value for all. */
  edgeSpeeds: readonly number[] | number;
  lateralAccel: number;
  minTurnSpeed: number;
  motion: PathMotion;
}

const MIN_TURN_ANGLE = 1e-4;

function dedupe(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || distance(last, p) > 1e-6) out.push(p);
  }
  return out;
}

/**
 * Converts a polyline (e.g. a taxi route through graph nodes) into a smooth path by rounding
 * every corner with a tangent arc. The path never leaves the polyline's corridor.
 */
export function buildFilletedPath(points: readonly Vec2[], opts: FilletOptions): Path {
  const pts = dedupe(points);
  if (pts.length < 2) throw new Error('A polyline path needs at least two distinct points');
  const n = pts.length;
  const edgeSpeed = (i: number): number =>
    typeof opts.edgeSpeeds === 'number' ? opts.edgeSpeeds : (opts.edgeSpeeds[i] ?? opts.edgeSpeeds[opts.edgeSpeeds.length - 1] ?? 1);

  const tangentLen = new Array<number>(n).fill(0);
  const corners = new Array<PathSegment | null>(n).fill(null);

  for (let i = 1; i < n - 1; i++) {
    const prev = pts[i - 1] as Vec2;
    const cur = pts[i] as Vec2;
    const next = pts[i + 1] as Vec2;
    const u = normalize(sub(cur, prev));
    const v = normalize(sub(next, cur));
    const phi = Math.atan2(cross(u, v), dot(u, v));
    if (Math.abs(phi) < MIN_TURN_ANGLE) continue;

    const lenIn = distance(prev, cur);
    const lenOut = distance(cur, next);
    const maxT = Math.min(i - 1 === 0 ? lenIn : lenIn / 2, i + 1 === n - 1 ? lenOut : lenOut / 2) * 0.999;
    const halfTan = Math.tan(Math.abs(phi) / 2);
    let radius = opts.filletRadius;
    let t = radius * halfTan;
    if (t > maxT) {
      t = maxT;
      radius = t / halfTan;
    }
    const a = sub(cur, scale(u, t));
    const sign = Math.sign(phi);
    const center = add(a, scale(leftNormal(u), radius * sign));
    const startAngle = Math.atan2(a.y - center.y, a.x - center.x);
    const turnSpeed = clamp(
      Math.sqrt(opts.lateralAccel * radius),
      opts.minTurnSpeed,
      Math.min(edgeSpeed(i - 1), edgeSpeed(i)),
    );
    corners[i] = arcSegment(center, radius, startAngle, phi, turnSpeed);
    tangentLen[i] = t;
  }

  const segments: PathSegment[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p = pts[i] as Vec2;
    const q = pts[i + 1] as Vec2;
    const u = normalize(sub(q, p));
    segments.push(lineSegment(add(p, scale(u, tangentLen[i] as number)), sub(q, scale(u, tangentLen[i + 1] as number)), edgeSpeed(i)));
    const corner = corners[i + 1];
    if (corner) segments.push(corner);
  }
  return new Path(segments, opts.motion);
}

/**
 * Clockwise racetrack holding pattern. The first leg starts at the west end of the north leg
 * and flies east.
 */
export function buildRacetrackLoop(
  center: Vec2,
  straightLength: number,
  radius: number,
  speed: number,
  motion: PathMotion,
): Path {
  const half = straightLength / 2;
  const segments: PathSegment[] = [
    lineSegment({ x: center.x - half, y: center.y + radius }, { x: center.x + half, y: center.y + radius }, speed),
    arcSegment({ x: center.x + half, y: center.y }, radius, Math.PI / 2, -Math.PI, speed),
    lineSegment({ x: center.x + half, y: center.y - radius }, { x: center.x - half, y: center.y - radius }, speed),
    arcSegment({ x: center.x - half, y: center.y }, radius, -Math.PI / 2, -Math.PI, speed),
  ];
  return new Path(segments, motion, true);
}
