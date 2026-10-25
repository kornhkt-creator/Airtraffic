import type { Vec2 } from './types';

export const TAU = Math.PI * 2;
export const MS_TO_KT = 1.943844;
export const M_TO_FT = 3.28084;

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalize(a: Vec2): Vec2 {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Unit vector rotated 90° counter-clockwise. */
export const leftNormal = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const fromAngle = (angle: number): Vec2 => ({ x: Math.cos(angle), y: Math.sin(angle) });

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Wraps an angle into (-PI, PI]. */
export function normalizeAngle(a: number): number {
  const r = mod(a + Math.PI, TAU) - Math.PI;
  return r === -Math.PI ? Math.PI : r;
}

/** Signed shortest rotation from a to b. */
export const angleDiff = (a: number, b: number): number => normalizeAngle(b - a);
export const lerpAngle = (a: number, b: number, t: number): number => a + angleDiff(a, b) * t;

/** Converts a math heading (0 = east, CCW) to a compass heading in degrees (0 = north, CW). */
export function toCompassDeg(angle: number): number {
  return mod(90 - (angle * 180) / Math.PI, 360);
}
