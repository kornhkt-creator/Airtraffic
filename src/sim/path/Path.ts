import type { Vec2 } from '../types';
import { clamp, mod, normalizeAngle } from '../math';

export interface LineSegment {
  readonly kind: 'line';
  readonly start: Vec2;
  readonly end: Vec2;
  readonly heading: number;
  readonly length: number;
  readonly maxSpeed: number;
}

/** Circular arc. Positive sweep turns left (counter-clockwise), negative turns right. */
export interface ArcSegment {
  readonly kind: 'arc';
  readonly center: Vec2;
  readonly radius: number;
  /** Angle of the radius vector (center → start point). */
  readonly startAngle: number;
  readonly sweep: number;
  readonly length: number;
  readonly maxSpeed: number;
}

export type PathSegment = LineSegment | ArcSegment;

export interface PathSample {
  position: Vec2;
  heading: number;
}

export interface PathMotion {
  readonly accel: number;
  readonly decel: number;
}

const MIN_SEGMENT_LENGTH = 1e-6;

export function lineSegment(start: Vec2, end: Vec2, maxSpeed: number): LineSegment {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    kind: 'line',
    start: { ...start },
    end: { ...end },
    heading: Math.atan2(dy, dx),
    length: Math.hypot(dx, dy),
    maxSpeed,
  };
}

export function arcSegment(
  center: Vec2,
  radius: number,
  startAngle: number,
  sweep: number,
  maxSpeed: number,
): ArcSegment {
  return { kind: 'arc', center: { ...center }, radius, startAngle, sweep, length: radius * Math.abs(sweep), maxSpeed };
}

export function sampleSegment(seg: PathSegment, d: number): PathSample {
  if (seg.kind === 'line') {
    const t = seg.length > 0 ? clamp(d / seg.length, 0, 1) : 0;
    return {
      position: { x: seg.start.x + (seg.end.x - seg.start.x) * t, y: seg.start.y + (seg.end.y - seg.start.y) * t },
      heading: seg.heading,
    };
  }
  const dir = seg.sweep >= 0 ? 1 : -1;
  const angle = seg.startAngle + (dir * clamp(d, 0, seg.length)) / seg.radius;
  return {
    position: { x: seg.center.x + seg.radius * Math.cos(angle), y: seg.center.y + seg.radius * Math.sin(angle) },
    heading: normalizeAngle(angle + (dir * Math.PI) / 2),
  };
}

/**
 * Immutable, continuous 2D path made of lines and arcs. Aircraft move along it by arc length,
 * which guarantees smooth motion with bounded turn radius and no teleporting.
 */
export class Path {
  readonly segments: readonly PathSegment[];
  readonly length: number;
  private readonly starts: readonly number[];

  constructor(
    segments: readonly PathSegment[],
    readonly motion: PathMotion,
    readonly loop = false,
  ) {
    const filtered = segments.filter((s) => s.length > MIN_SEGMENT_LENGTH);
    if (filtered.length === 0) throw new Error('A path needs at least one non-empty segment');
    const starts: number[] = [];
    let total = 0;
    for (const seg of filtered) {
      starts.push(total);
      total += seg.length;
    }
    this.segments = filtered;
    this.starts = starts;
    this.length = total;
  }

  private wrap(s: number): number {
    return this.loop ? mod(s, this.length) : clamp(s, 0, this.length);
  }

  segmentIndexAt(s: number): number {
    const t = this.wrap(s);
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const midIndex = (lo + hi + 1) >> 1;
      if ((this.starts[midIndex] as number) <= t) lo = midIndex;
      else hi = midIndex - 1;
    }
    return lo;
  }

  sample(s: number): PathSample {
    const t = this.wrap(s);
    const i = this.segmentIndexAt(t);
    return sampleSegment(this.segments[i] as PathSegment, t - (this.starts[i] as number));
  }

  get startSample(): PathSample {
    return this.sample(0);
  }

  get endSample(): PathSample {
    return this.sample(this.length);
  }

  /**
   * Highest speed allowed at distance s so the aircraft can still slow down for every upcoming
   * segment limit and for the required speed at the end of the path.
   */
  speedLimitAt(s: number, endSpeed: number): number {
    const t = this.wrap(s);
    const i = this.segmentIndexAt(t);
    const n = this.segments.length;
    const twoDecel = 2 * this.motion.decel;
    let limit = (this.segments[i] as PathSegment).maxSpeed;
    for (let k = 1; k < n; k++) {
      if (!this.loop && i + k >= n) break;
      const j = (i + k) % n;
      let dist = (this.starts[j] as number) - t;
      if (dist < 0) dist += this.length;
      const segMax = (this.segments[j] as PathSegment).maxSpeed;
      limit = Math.min(limit, Math.sqrt(segMax * segMax + twoDecel * dist));
    }
    if (!this.loop) {
      limit = Math.min(limit, Math.sqrt(endSpeed * endSpeed + twoDecel * (this.length - t)));
    }
    return limit;
  }

  /** Evenly spaced samples for rendering route lines. */
  samplePoints(spacing: number): { s: number; position: Vec2 }[] {
    const count = Math.max(1, Math.ceil(this.length / spacing));
    const points: { s: number; position: Vec2 }[] = [];
    for (let k = 0; k <= count; k++) {
      const s = (this.length * k) / count;
      points.push({ s, position: this.sample(this.loop && k === count ? 0 : s).position });
    }
    return points;
  }
}
