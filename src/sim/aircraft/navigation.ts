import type { Aircraft, Vec2 } from '../types';
import { SIM_CONFIG } from '../config';
import { AIRPORT, type AirportLayout } from '../airport/layout';
import type { RouteManager } from '../airport/RouteManager';
import { buildFilletedPath, buildRacetrackLoop } from '../path/builders';
import { dubinsSegments } from '../path/dubins';
import { lineSegment, Path, type PathMotion } from '../path/Path';
import { distance, dot, fromAngle, normalize, sub } from '../math';

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

/**
 * Taxi path along a graph route. `startPoint` (e.g. the end of a pushback) is prepended when the
 * aircraft is not standing exactly on the route's first node.
 */
export function planTaxi(route: readonly string[], routes: RouteManager, startPoint?: Vec2): Path {
  const g = SIM_CONFIG.ground;
  const edgeSpeeds = routes.edgesOf(route).map((e) =>
    e.kind === 'stand' ? g.standSpeed : e.kind === 'apron' ? g.apronSpeed : g.maxTaxiSpeed,
  );
  const points = routes.positions(route);
  if (startPoint) {
    points.unshift(startPoint);
    edgeSpeeds.unshift(g.apronSpeed);
  }
  return buildFilletedPath(points, {
    filletRadius: g.filletRadius,
    edgeSpeeds,
    lateralAccel: g.lateralAccel,
    minTurnSpeed: g.minTurnSpeed,
    motion: TAXI_MOTION,
  });
}

/** Apron node directly connected to a gate stand. */
export function apronNodeOf(gateId: string, routes: RouteManager): string {
  const nb = routes.neighbors(gateId, new Set(['stand']))[0];
  if (!nb) throw new Error(`Gate ${gateId} has no stand connection`);
  return nb.id;
}

/** Shortest taxi route from a node to any holding point. */
function routeToNearestHoldingPoint(from: string, routes: RouteManager): string[] | null {
  let best: string[] | null = null;
  let bestLength = Infinity;
  for (const hp of routes.layout.holdingPointIds) {
    const r = routes.findRoute(from, hp);
    if (!r) continue;
    const length = r.reduce((sum, id, i) => (i === 0 ? 0 : sum + distance(routes.node(r[i - 1] as string).position, routes.node(id).position)), 0);
    if (length < bestLength) {
      best = r;
      bestLength = length;
    }
  }
  return best;
}

/**
 * Tail-first path from the gate onto the apron lane. The aircraft ends up facing the direction it
 * will most likely taxi (toward the nearest holding point).
 */
export function planPushback(gateId: string, routes: RouteManager): { path: Path; apronNodeId: string; endPoint: Vec2 } {
  const g = SIM_CONFIG.ground;
  const apronNodeId = apronNodeOf(gateId, routes);
  const apron = routes.node(apronNodeId).position;
  const next = routeToNearestHoldingPoint(apronNodeId, routes)?.[1];
  // Face the first leg toward the runway; fall back to east if no route exists.
  const facing = next ? normalize(sub(routes.node(next).position, apron)) : { x: 1, y: 0 };
  const endPoint = { x: apron.x - facing.x * g.pushbackLength, y: apron.y - facing.y * g.pushbackLength };
  const path = buildFilletedPath([routes.node(gateId).position, apron, endPoint], {
    filletRadius: g.filletRadius,
    edgeSpeeds: g.pushbackSpeed,
    lateralAccel: g.lateralAccel,
    minTurnSpeed: Math.min(g.minTurnSpeed, g.pushbackSpeed),
    motion: { accel: g.pushbackAccel, decel: g.taxiDecel },
  });
  return { path, apronNodeId, endPoint };
}

/** Runway node joined to a holding point by its runway connector. */
export function runwayEntryOf(holdingPointId: string, routes: RouteManager): string {
  const nb = routes.neighbors(holdingPointId, new Set(['runwayConnector']))[0];
  if (!nb) throw new Error(`Holding point ${holdingPointId} has no runway connector`);
  return nb.id;
}

/** From the holding point onto the runway, ending aligned with the runway heading. */
export function planLineUp(holdingPointId: string, routes: RouteManager): Path {
  const g = SIM_CONFIG.ground;
  const { runway } = routes.layout;
  const entry = routes.node(runwayEntryOf(holdingPointId, routes)).position;
  const dir = fromAngle(runway.heading);
  const lineUpPoint = { x: entry.x + dir.x * g.lineUpDistance, y: entry.y + dir.y * g.lineUpDistance };
  return buildFilletedPath([routes.node(holdingPointId).position, entry, lineUpPoint], {
    filletRadius: g.filletRadius,
    edgeSpeeds: g.apronSpeed,
    lateralAccel: g.lateralAccel,
    minTurnSpeed: g.minTurnSpeed,
    motion: TAXI_MOTION,
  });
}

/** Straight takeoff roll and climb-out along the runway heading to the handoff point. */
export function planTakeoff(ac: Aircraft, layout: AirportLayout = AIRPORT): Path {
  const d = SIM_CONFIG.departure;
  const dir = fromAngle(layout.runway.heading);
  const handoff = { x: layout.runway.end.x + dir.x * d.handoffDistance, y: layout.runway.end.y + dir.y * d.handoffDistance };
  return new Path([lineSegment(ac.position, handoff, d.climbSpeed)], { accel: d.takeoffAccel, decel: SIM_CONFIG.air.decel });
}

/** Distance travelled past the far end of the runway (negative while still over the runway). */
export function distancePastRunwayEnd(position: Vec2, layout: AirportLayout = AIRPORT): number {
  return dot(sub(position, layout.runway.end), fromAngle(layout.runway.heading));
}
