import type { Vec2 } from '../types';
import { angleDiff, distance, mod, TAU } from '../math';
import { arcSegment, lineSegment, sampleSegment, type PathSegment } from './Path';

export interface Pose {
  position: Vec2;
  heading: number;
}

type Turn = 'L' | 'S' | 'R';

interface Candidate {
  word: readonly [Turn, Turn, Turn];
  /** Normalized lengths: radians for turns, distance / radius for straights. */
  params: readonly [number, number, number];
}

function candidates(alpha: number, beta: number, d: number): Candidate[] {
  const sa = Math.sin(alpha);
  const sb = Math.sin(beta);
  const ca = Math.cos(alpha);
  const cb = Math.cos(beta);
  const cab = Math.cos(alpha - beta);
  const out: Candidate[] = [];

  // LSL
  {
    const p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
    if (p2 >= 0) {
      const tmp = Math.atan2(cb - ca, d + sa - sb);
      out.push({ word: ['L', 'S', 'L'], params: [mod(-alpha + tmp, TAU), Math.sqrt(p2), mod(beta - tmp, TAU)] });
    }
  }
  // RSR
  {
    const p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
    if (p2 >= 0) {
      const tmp = Math.atan2(ca - cb, d - sa + sb);
      out.push({ word: ['R', 'S', 'R'], params: [mod(alpha - tmp, TAU), Math.sqrt(p2), mod(-beta + tmp, TAU)] });
    }
  }
  // LSR
  {
    const p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
    if (p2 >= 0) {
      const p = Math.sqrt(p2);
      const tmp = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p);
      out.push({ word: ['L', 'S', 'R'], params: [mod(-alpha + tmp, TAU), p, mod(-mod(beta, TAU) + tmp, TAU)] });
    }
  }
  // RSL
  {
    const p2 = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
    if (p2 >= 0) {
      const p = Math.sqrt(p2);
      const tmp = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p);
      out.push({ word: ['R', 'S', 'L'], params: [mod(alpha - tmp, TAU), p, mod(beta - tmp, TAU)] });
    }
  }
  // RLR
  {
    const tmp = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8;
    if (Math.abs(tmp) <= 1) {
      const p = mod(TAU - Math.acos(tmp), TAU);
      const t = mod(alpha - Math.atan2(ca - cb, d - sa + sb) + p / 2, TAU);
      out.push({ word: ['R', 'L', 'R'], params: [t, p, mod(alpha - beta - t + p, TAU)] });
    }
  }
  // LRL
  {
    const tmp = (6 - d * d + 2 * cab + 2 * d * (-sa + sb)) / 8;
    if (Math.abs(tmp) <= 1) {
      const p = mod(TAU - Math.acos(tmp), TAU);
      const t = mod(-alpha - Math.atan2(ca - cb, d + sa - sb) + p / 2, TAU);
      out.push({ word: ['L', 'R', 'L'], params: [t, p, mod(mod(beta, TAU) - alpha - t + p, TAU)] });
    }
  }
  return out;
}

function buildSegments(start: Pose, c: Candidate, radius: number, maxSpeed: number): { segments: PathSegment[]; end: Pose } {
  let pos = { ...start.position };
  let heading = start.heading;
  const segments: PathSegment[] = [];
  for (let k = 0; k < 3; k++) {
    const turn = c.word[k] as Turn;
    const param = c.params[k] as number;
    let seg: PathSegment;
    if (turn === 'S') {
      const lengthM = param * radius;
      seg = lineSegment(pos, { x: pos.x + Math.cos(heading) * lengthM, y: pos.y + Math.sin(heading) * lengthM }, maxSpeed);
    } else {
      const sign = turn === 'L' ? 1 : -1;
      const center = { x: pos.x - Math.sin(heading) * radius * sign, y: pos.y + Math.cos(heading) * radius * sign };
      seg = arcSegment(center, radius, heading - (sign * Math.PI) / 2, sign * param, maxSpeed);
    }
    const endSample = sampleSegment(seg, seg.length);
    pos = endSample.position;
    heading = turn === 'S' ? heading : heading + (turn === 'L' ? param : -param);
    segments.push(seg);
  }
  return { segments, end: { position: pos, heading } };
}

/**
 * Shortest curvature-bounded path (Dubins) between two poses. Every candidate is rebuilt and its
 * end pose verified, so only geometrically correct solutions are ever returned.
 */
export function dubinsSegments(start: Pose, end: Pose, radius: number, maxSpeed: number): PathSegment[] {
  const dx = end.position.x - start.position.x;
  const dy = end.position.y - start.position.y;
  const d = Math.hypot(dx, dy) / radius;
  const theta = mod(Math.atan2(dy, dx), TAU);
  const alpha = mod(start.heading - theta, TAU);
  const beta = mod(end.heading - theta, TAU);

  let best: { segments: PathSegment[]; length: number } | null = null;
  for (const c of candidates(alpha, beta, d)) {
    const built = buildSegments(start, c, radius, maxSpeed);
    const posError = distance(built.end.position, end.position);
    const headingError = Math.abs(angleDiff(built.end.heading, end.heading));
    if (posError > 0.5 || headingError > 1e-3) continue;
    const total = built.segments.reduce((sum, s) => sum + s.length, 0);
    if (!best || total < best.length) best = { segments: built.segments, length: total };
  }
  if (!best) throw new Error('No valid Dubins path found');
  return best.segments;
}
