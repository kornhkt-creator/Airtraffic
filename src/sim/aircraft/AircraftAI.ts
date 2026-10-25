import type { Aircraft } from '../types';
import type { SimWorld } from '../world';
import { SIM_CONFIG } from '../config';
import { transition } from './AircraftStateMachine';
import { advanceAlongPath, assignPath, remainingDistance, updateAltitude } from './MovementSystem';
import { glideAltitude, planRollout, planTaxi } from './navigation';

/** Starts taxiing along a validated ground route. */
export function beginTaxi(world: SimWorld, ac: Aircraft, route: string[]): void {
  transition(ac, 'TAXIING', (e) => world.emit(e));
  ac.routeNodeIds = route;
  ac.pendingRoute = null;
  assignPath(ac, planTaxi(route, world.routes), 'taxi', 0);
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

function arriveAtGate(world: SimWorld, ac: Aircraft): void {
  transition(ac, 'AT_GATE', (e) => world.emit(e));
  ac.gateId = ac.destinationId;
  ac.destinationId = null;
  ac.speed = 0;
  assignPath(ac, null, 'none', 0);
  if (ac.flightType === 'ARRIVAL') world.emit({ type: 'FLIGHT_COMPLETED', aircraftId: ac.id });
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
      if (advanceAlongPath(ac, dt)) arriveAtGate(world, ac);
      break;
    }
    case 'AT_GATE':
      ac.speed = 0;
      break;
    default:
      // States for departures and incidents are implemented in later milestones.
      break;
  }
}
