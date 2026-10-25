import type { Vec2 } from '../sim/types';

/** Maps sim coordinates (x east, y north, altitude) to Three.js (x, up, -north). */
export function toScene(p: Vec2, altitude = 0): [number, number, number] {
  return [p.x, altitude, -p.y];
}

/** A sim heading becomes a rotation about the Three.js Y axis for models built along +X. */
export const headingToRotationY = (heading: number): number => heading;
