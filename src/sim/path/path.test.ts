import { describe, expect, it } from 'vitest';
import { angleDiff, distance } from '../math';
import { Rng } from '../rng';
import { buildFilletedPath, buildRacetrackLoop } from './builders';
import { dubinsSegments } from './dubins';
import { Path, sampleSegment } from './Path';

const motion = { accel: 1, decel: 1.5 };

function expectContinuous(path: Path): void {
  for (let i = 0; i < path.segments.length - 1; i++) {
    const a = path.segments[i]!;
    const b = path.segments[i + 1]!;
    const end = sampleSegment(a, a.length);
    const start = sampleSegment(b, 0);
    expect(distance(end.position, start.position)).toBeLessThan(1e-6);
    expect(Math.abs(angleDiff(end.heading, start.heading))).toBeLessThan(1e-6);
  }
}

describe('buildFilletedPath', () => {
  const points = [
    { x: 0, y: -90 },
    { x: 0, y: -180 },
    { x: -200, y: -180 },
    { x: -200, y: -280 },
    { x: -300, y: -280 },
    { x: -300, y: -360 },
  ];
  const path = buildFilletedPath(points, { filletRadius: 40, edgeSpeeds: 10, lateralAccel: 1, minTurnSpeed: 3, motion });

  it('starts and ends exactly at the polyline end points', () => {
    expect(distance(path.startSample.position, points[0]!)).toBeLessThan(1e-9);
    expect(distance(path.endSample.position, points[points.length - 1]!)).toBeLessThan(1e-9);
  });

  it('is position- and heading-continuous between segments', () => {
    expectContinuous(path);
  });

  it('is shorter than the polyline (corners are cut by arcs) but never by more than the corners', () => {
    let poly = 0;
    for (let i = 0; i < points.length - 1; i++) poly += distance(points[i]!, points[i + 1]!);
    expect(path.length).toBeLessThan(poly);
    expect(path.length).toBeGreaterThan(poly - 4 * 40);
  });

  it('limits speed before corners and to zero at the end', () => {
    expect(path.speedLimitAt(path.length, 0)).toBeCloseTo(0);
    const firstArc = path.segments.findIndex((s) => s.kind === 'arc');
    expect(firstArc).toBeGreaterThan(0);
    expect(path.speedLimitAt(0, 0)).toBeLessThanOrEqual(10);
  });
});

describe('buildRacetrackLoop', () => {
  it('forms a closed, continuous loop', () => {
    const loop = buildRacetrackLoop({ x: 0, y: 0 }, 2000, 500, 70, motion);
    expectContinuous(loop);
    const start = loop.sample(0);
    const end = sampleSegment(loop.segments[loop.segments.length - 1]!, loop.segments[loop.segments.length - 1]!.length);
    expect(distance(start.position, end.position)).toBeLessThan(1e-6);
    expect(loop.sample(loop.length + 10).position.x).toBeCloseTo(loop.sample(10).position.x);
  });
});

describe('dubinsSegments', () => {
  it('connects random poses exactly with bounded turn radius', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 200; i++) {
      const start = { position: { x: rng.range(-5000, 5000), y: rng.range(-5000, 5000) }, heading: rng.range(-Math.PI, Math.PI) };
      const end = { position: { x: rng.range(-5000, 5000), y: rng.range(-5000, 5000) }, heading: rng.range(-Math.PI, Math.PI) };
      const path = new Path(dubinsSegments(start, end, 700, 70), motion);
      expectContinuous(path);
      expect(distance(path.startSample.position, start.position)).toBeLessThan(1e-6);
      expect(Math.abs(angleDiff(path.startSample.heading, start.heading))).toBeLessThan(1e-6);
      expect(distance(path.endSample.position, end.position)).toBeLessThan(0.5);
      for (const seg of path.segments) if (seg.kind === 'arc') expect(seg.radius).toBeCloseTo(700);
    }
  });
});
