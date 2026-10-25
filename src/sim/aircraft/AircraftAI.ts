import type { Aircraft } from '../types';
import type { SimWorld } from '../world';
import { SIM_CONFIG } from '../config';
import { transition } from './AircraftStateMachine';
import { advanceAlongPath, assignPath, remainingDistance, updateAltitude } from './MovementSystem';
import { distancePastRunwayEnd, glideAltitude, planRollout, planTaxi } from './navigation';

/**
 * Starts taxiing along a validated ground route. `startPoint` is used when the aircraft is not on
 * the route's first node (after a pushback).
 */
export function beginTaxi(world: SimWorld, ac: Aircraft, route: string[]): void {
  const startPoint = ac.status === 'PUSHBACK' ? ac.pushback?.endPoint : undefined;
  transition(ac, 'TAXIING', (e) => world.emit(e));
  ac.routeNodeIds = route;
  ac.pendingRoute = null;
  ac.pushback = null;
  ac.holdingPointId = null;
  assignPath(ac, planTaxi(route, world.routes, startPoint), 'taxi', 0);
}

function touchdown(world: SimWorld, ac: Aircraft): void {
  ac.altitude = 0;
  transition(ac, 'LANDED', (e) => world.emit(e));
  ac.onRunway = true;
  const { path, exitNodeId } = planRollout(ac, world.routes);
  ac.exitNodeId = exitNodeId;
  assignPath(ac, path, 'rollout', 0);
}

function vacateRunway(world: SimWorld, ac: Aircraft): void {
  ac.onRunway = false;
  world.emit({ type: 'RUNWAY_VACATED', aircraftId: ac.id });
  if (ac.pendingRoute) beginTaxi(world, ac, ac.pendingRoute);
  else assignPath(ac, null, 'none', 0);
}

function finishTaxi(world: SimWorld, ac: Aircraft): void {
  const destination = ac.destinationId;
  ac.destinationId = null;
  ac.speed = 0;
  assignPath(ac, null, 'none', 0);
  if (destination && world.routes.node(destination).kind === 'holdingPoint') {
    transition(ac, 'HOLDING', (e) => world.emit(e));
    ac.holdingPointId = destination;
    return;
  }
  transition(ac, 'AT_GATE', (e) => world.emit(e));
  ac.gateId = destination;
  if (ac.flightType === 'ARRIVAL') world.emit({ type: 'FLIGHT_COMPLETED', aircraftId: ac.id });
}

function finishPushback(world: SimWorld, ac: Aircraft): void {
  ac.gateId = null;
  assignPath(ac, null, 'none', 0);
  world.emit({ type: 'PUSHBACK_COMPLETED', aircraftId: ac.id });
  if (ac.pendingRoute) beginTaxi(world, ac, ac.pendingRoute);
}

function updateTakeoff(world: SimWorld, ac: Aircraft, dt: number): void {
  const d = SIM_CONFIG.departure;
  const finished = advanceAlongPath(ac, dt);
  if (ac.speed >= d.rotationSpeed || ac.altitude > 0) updateAltitude(ac, d.climbAltitude, d.climbRate, dt);
  if (ac.onRunway && distancePastRunwayEnd(ac.position, world.routes.layout) > 0) {
    ac.onRunway = false;
    world.emit({ type: 'RUNWAY_VACATED', aircraftId: ac.id });
  }
  if (finished) {
    transition(ac, 'DEPARTED', (e) => world.emit(e));
    assignPath(ac, null, 'none', 0);
    world.emit({ type: 'FLIGHT_COMPLETED', aircraftId: ac.id });
  }
}

/** Per-tick behavior for one aircraft, driven by its current status. */
export function updateAircraft(world: SimWorld, ac: Aircraft, dt: number): void {
  const air = SIM_CONFIG.air;
  switch (ac.status) {
    case 'APPROACH': {
      advanceAlongPath(ac, dt);
      updateAltitude(ac, air.holdingAltitude, air.maxVerticalSpeed, dt);
      ac.waitTime += dt;
      break;
    }
    case 'LANDING': {
      const finished = advanceAlongPath(ac, dt);
      updateAltitude(ac, glideAltitude(remainingDistance(ac)), air.maxVerticalSpeed, dt);
      if (finished) touchdown(world, ac);
      break;
    }
    case 'LANDED': {
      const finished = advanceAlongPath(ac, dt);
      if (finished && ac.nav.kind === 'rollout') vacateRunway(world, ac);
      else if (!ac.onRunway && !ac.pendingRoute) ac.waitTime += dt;
      break;
    }
    case 'TAXIING': {
      if (advanceAlongPath(ac, dt)) finishTaxi(world, ac);
      break;
    }
    case 'AT_GATE':
      ac.speed = 0;
      if (ac.flightType === 'DEPARTURE') ac.waitTime += dt;
      break;
    case 'PUSHBACK': {
      const finished = advanceAlongPath(ac, dt);
      if (finished && ac.nav.kind === 'pushback') finishPushback(world, ac);
      else if (!ac.nav.path && !ac.pendingRoute) ac.waitTime += dt;
      break;
    }
    case 'HOLDING':
      ac.speed = 0;
      ac.waitTime += dt;
      break;
    case 'LINE_UP': {
      const finished = advanceAlongPath(ac, dt);
      if (finished) assignPath(ac, null, 'none', 0);
      else if (!ac.nav.path) ac.waitTime += dt;
      break;
    }
    case 'TAKEOFF':
      updateTakeoff(world, ac, dt);
      break;
    default:
      // GO_AROUND, DIVERTED and CRASHED behavior arrives with later milestones.
      break;
  }
}
