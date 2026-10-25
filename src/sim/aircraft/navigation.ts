import type { Aircraft, Vec2 } from '../types';
import { SIM_CONFIG } from '../config';
import { AIRPORT, type AirportLayout } from '../airport/layout';
import type { RouteManager } from '../airport/RouteManager';
import { buildFilletedPath, buildRacetrackLoop } from '../path/builders';
import { dubinsSegments } from '../path/dubins';
import { lineSegment, Path, type PathMotion } from '../path/Path';
import { dot, fromAngle, sub } from '../math';

const AIR_MOTION: PathMotion = { accel: SIM_CONFIG.air.accel, decel: SIM_CONFIG.air.decel };
const TAXI_MOTION: PathMotion = { accel: SIM_CONFIG.ground.accel, decel: SIM_CONFIG.ground.taxiDecel };
const ROLLOUT_MOTION: PathMotion = { accel: SIM_CONFIG.ground.accel, decel: SIM_CONFIG.ground.rolloutDecel };

const glideTan = Math.tan((SIM_CONFIG.air.glideSlopeDeg * Math.PI) / 180);

export function createHoldingLoop(layout: AirportLayout = AIRPORT): Path {
  const a = layout.approach;
  return buildRacetrackLoop(a.holdingCenter, a.holdingStraight, a.holdingRadius, SIM_CONFIG.air.approachSpeed, AIR_MOTION);
}

/** Target altitude on the approach given the remaining distance to touchdown. */
export function glideAltitude(remainingToTouchdown: number): number {
  return Math.min(SIM_CONFIG.air.holdingAltitude, Math.max(0, remainingToTouchdown) * glideTan);
}

/** Curvature-bounded path from the aircraft's current pose to the FAF, then straight to touchdown. */
export function planLanding(ac: Aircraft, layout: AirportLayout = AIRPORT): Path {
  const { runway, approach } = layout;
  const speed = SIM_CONFIG.air.approachSpeed;
  const toFaf = dubinsSegments(
    { position: ac.position, heading: ac.heading },
    { position: approach.faf, heading: runway.heading },
    SIM_CONFIG.air.turnRadius,
    speed,
  );
  return new Path([...toFaf, lineSegment(approach.faf, runway.touchdown, speed)], AIR_MOTION);
}

/** Picks the first runway exit the aircraft can still slow down for. */
export function chooseRunwayExit(position: Vec2, speed: number, routes: RouteManager): { runwayNodeId: string; exitNodeId: string } {
  const { runway } = routes.layout;
  const g = SIM_CONFIG.ground;
  const turnSpeed = Math.sqrt(g.lateralAccel * g.filletRadius);
  const required = Math.max(0, speed * speed - turnSpeed * turnSpeed) / (2 * g.rolloutDecel) + g.filletRadius + g.exitMargin;
  const forward = fromAngle(runway.heading);
  const exits = runway.exits;
  for (const exit of exits) {
    const along = dot(sub(routes.node(exit.runwayNodeId).position, position), forward);
    if (along >= required) return exit;
  }
  const last = exits[exits.length - 1];
  if (!last) throw new Error('Runway has no exits');
  return last;
}

export function planRollout(ac: Aircraft, routes: RouteManager): { path: Path; exitNodeId: string } {
  const g = SIM_CONFIG.ground;
  const exit = chooseRunwayExit(ac.position, ac.speed, routes);
  const path = buildFilletedPath([ac.position, routes.node(exit.runwayNodeId).position, routes.node(exit.exitNodeId).position], {
    filletRadius: g.filletRadius,
    edgeSpeeds: [g.runwayMaxSpeed, g.maxTaxiSpeed],
    lateralAccel: g.lateralAccel,
    minTurnSpeed: g.minTurnSpeed,
    motion: ROLLOUT_MOTION,
  });
  return { path, exitNodeId: exit.exitNodeId };
}

export function planTaxi(route: readonly string[], routes: RouteManager): Path {
  const g = SIM_CONFIG.ground;
  const edgeSpeeds = routes.edgesOf(route).map((e) =>
    e.kind === 'stand' ? g.standSpeed : e.kind === 'apron' ? g.apronSpeed : g.maxTaxiSpeed,
  );
  return buildFilletedPath(routes.positions(route), {
    filletRadius: g.filletRadius,
    edgeSpeeds,
    lateralAccel: g.lateralAccel,
    minTurnSpeed: g.minTurnSpeed,
    motion: TAXI_MOTION,
  });
}
