import type { Aircraft, NavKind } from '../types';
import type { Path } from '../path/Path';
import { mod, normalizeAngle } from '../math';
import { SIM_CONFIG } from '../config';

/** Distance at which an aircraft is considered to have reached the end of its path. */
const ARRIVAL_EPSILON = 0.05;
/** Minimum speed while closing the last meters to a stop point (avoids never arriving). */
const CREEP_SPEED = 0.5;
/** Braking may exceed the planned deceleration by this factor to absorb discretization error. */
const BRAKE_MARGIN = 2;

export function assignPath(ac: Aircraft, path: Path | null, kind: NavKind, endSpeed: number, reverse = false): void {
  ac.nav.path = path;
  ac.nav.s = 0;
  ac.nav.kind = path ? kind : 'none';
  ac.nav.endSpeed = endSpeed;
  ac.nav.reverse = path ? reverse : false;
  ac.nav.version += 1;
}

export function remainingDistance(ac: Aircraft): number {
  const path = ac.nav.path;
  if (!path) return 0;
  return path.loop ? Infinity : path.length - ac.nav.s;
}

/**
 * Moves an aircraft along its path for one tick with acceleration-limited speed changes.
 * Returns true on the tick the end of a non-looping path is reached.
 */
export function advanceAlongPath(ac: Aircraft, dt: number, speedCap = Infinity): boolean {
  const nav = ac.nav;
  const path = nav.path;
  if (!path) {
    ac.speed = Math.max(0, ac.speed - SIM_CONFIG.ground.stopDecel * dt);
    return false;
  }

  const remaining = path.loop ? Infinity : path.length - nav.s;
  let target = Math.min(path.speedLimitAt(nav.s, nav.endSpeed), speedCap);
  if (nav.endSpeed === 0 && remaining > ARRIVAL_EPSILON) target = Math.max(target, Math.min(CREEP_SPEED, speedCap));

  if (ac.speed < target) ac.speed = Math.min(target, ac.speed + path.motion.accel * dt);
  else ac.speed = Math.max(target, ac.speed - path.motion.decel * BRAKE_MARGIN * dt);

  nav.s += ac.speed * dt;
  let finished = false;
  if (path.loop) {
    nav.s = mod(nav.s, path.length);
  } else if (path.length - nav.s <= ARRIVAL_EPSILON) {
    nav.s = path.length;
    finished = true;
    if (nav.endSpeed === 0) ac.speed = 0;
  }

  const sample = path.sample(nav.s);
  ac.position = sample.position;
  ac.heading = nav.reverse ? normalizeAngle(sample.heading + Math.PI) : sample.heading;
  return finished;
}

/** Moves altitude toward a target with a vertical speed limit. */
export function updateAltitude(ac: Aircraft, target: number, maxVerticalSpeed: number, dt: number): void {
  const diff = target - ac.altitude;
  const maxStep = maxVerticalSpeed * dt;
  ac.altitude += Math.max(-maxStep, Math.min(maxStep, diff));
  if (ac.altitude < 0) ac.altitude = 0;
}
