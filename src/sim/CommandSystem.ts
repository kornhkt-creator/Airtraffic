import type { Aircraft, Command, CommandType, SimpleCommandType } from './types';
import type { SimWorld } from './world';
import { SIM_CONFIG } from './config';
import { distance, dot, fromAngle, normalize, sub } from './math';
import { transition } from './aircraft/AircraftStateMachine';
import { assignPath } from './aircraft/MovementSystem';
import { beginTaxi } from './aircraft/AircraftAI';
import { apronNodeOf, planLanding, planLineUp, planPushback, planTakeoff } from './aircraft/navigation';
import { isRunwayAvailableFor, runwayOf } from './safety/SafetySystem';
import { levelAltitude } from './aircraft/holdingStack';

export type Validation = { ok: true; route?: string[] } | { ok: false; reason: string };

export interface DestinationOption {
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

export interface CommandOption {
  type: CommandType;
  label: string;
  enabled: boolean;
  reason?: string;
  destinations?: DestinationOption[];
}

const reject = (reason: string): Validation => ({ ok: false, reason });

/** Statuses in which an aircraft is physically on the ground and moving around the airport. */
const GROUND_TRAFFIC = new Set(['LANDED', 'TAXIING', 'PUSHBACK', 'HOLDING', 'LINE_UP']);

function checkGame(world: SimWorld): Validation | null {
  if (world.status !== 'RUNNING' && world.status !== 'PAUSED') return reject('The game is not running.');
  return null;
}

function checkRunway(world: SimWorld, ac: Aircraft): Validation | null {
  const { layout } = world.routes;
  const runway = isRunwayAvailableFor(world.aircraft, ac, layout);
  return runway.ok ? null : reject(`Runway ${runwayOf(ac, layout).designators[0]} is occupied by ${runway.occupant.callsign}.`);
}

function requireStatus(ac: Aircraft, status: Aircraft['status'], action: string): Validation | null {
  return ac.status === status ? null : reject(`${ac.callsign} is ${ac.status} — ${action} requires ${status}.`);
}

function requireType(ac: Aircraft, type: Aircraft['flightType'], action: string): Validation | null {
  return ac.flightType === type ? null : reject(`${ac.callsign} is ${ac.flightType === 'ARRIVAL' ? 'an arrival' : 'a departure'} — ${action} is not applicable.`);
}

export function validateLand(world: SimWorld, ac: Aircraft): Validation {
  const base = checkGame(world) ?? requireType(ac, 'ARRIVAL', 'landing clearance') ?? requireStatus(ac, 'APPROACH', 'landing clearance');
  if (base) return base;
  // Only the bottom of the holding stack can make the glide path in time.
  if ((ac.holdingLevel ?? 0) > 0) return reject(`${ac.callsign} is at holding level ${(ac.holdingLevel ?? 0) + 1} — only the lowest aircraft in the stack can be cleared to land.`);
  if (ac.altitude > levelAltitude(0) + SIM_CONFIG.air.landingAltitudeTolerance) return reject(`${ac.callsign} is still descending to the bottom of the holding stack.`);
  return checkRunway(world, ac) ?? { ok: true };
}

export function validatePushback(world: SimWorld, ac: Aircraft): Validation {
  const base = checkGame(world) ?? requireType(ac, 'DEPARTURE', 'pushback') ?? requireStatus(ac, 'AT_GATE', 'pushback');
  if (base) return base;
  if (!ac.gateId) return reject(`${ac.callsign} is not parked at a gate.`);
  const apron = world.routes.node(apronNodeOf(ac.gateId, world.routes)).position;
  const blocker = world.aircraft.find(
    (a) => a.id !== ac.id && GROUND_TRAFFIC.has(a.status) && distance(a.position, apron) < SIM_CONFIG.ground.pushbackClearance,
  );
  if (blocker) return reject(`Apron behind ${world.routes.label(ac.gateId)} is not clear — ${blocker.callsign} is too close.`);
  return { ok: true };
}

/** Node the aircraft's next ground route has to start from, or a reason it cannot taxi. */
function taxiStartNode(ac: Aircraft): { node: string } | { reason: string } {
  if (ac.status === 'LANDED') {
    if (!ac.exitNodeId) return { reason: `${ac.callsign} has no runway exit assigned yet.` };
    return { node: ac.exitNodeId };
  }
  if (ac.status === 'PUSHBACK') {
    if (!ac.pushback) return { reason: `${ac.callsign} has no pushback position.` };
    return { node: ac.pushback.apronNodeId };
  }
  const needed = ac.flightType === 'ARRIVAL' ? 'LANDED' : 'PUSHBACK';
  return { reason: `${ac.callsign} is ${ac.status} — taxi clearance requires ${needed}.` };
}

export function validateTaxi(world: SimWorld, ac: Aircraft, destinationId: string): Validation {
  const game = checkGame(world);
  if (game) return game;
  const start = taxiStartNode(ac);
  if ('reason' in start) return reject(start.reason);
  const { routes } = world;
  if (!routes.hasNode(destinationId)) return reject(`Unknown destination ${destinationId}.`);
  const dest = routes.node(destinationId);
  if (ac.flightType === 'ARRIVAL' && dest.kind !== 'gate') return reject('Arrivals must taxi to a gate.');
  if (ac.flightType === 'DEPARTURE' && dest.kind !== 'holdingPoint') return reject('Departures must taxi to a runway holding point.');
  const blocker = world.aircraft.find(
    (a) => a.id !== ac.id && (a.gateId === destinationId || a.holdingPointId === destinationId || a.destinationId === destinationId),
  );
  if (blocker) {
    const occupied = blocker.gateId === destinationId || blocker.holdingPointId === destinationId;
    return reject(`${routes.label(destinationId)} is ${occupied ? 'occupied' : 'reserved'} by ${blocker.callsign}.`);
  }
  const route = routes.findRoute(start.node, destinationId);
  if (!route || route.length < 2) return reject(`No valid taxi route to ${routes.label(destinationId)}.`);
  if (ac.status === 'PUSHBACK' && ac.pushback) {
    // The aircraft cannot reverse on its own: the route must continue in the direction it faces.
    const first = normalize(sub(routes.node(route[1] as string).position, routes.node(route[0] as string).position));
    const facing = normalize(sub(routes.node(ac.pushback.apronNodeId).position, ac.pushback.endPoint));
    if (dot(first, facing) < 0) return reject(`${ac.callsign} faces the wrong way for that route.`);
  }
  return { ok: true, route };
}

export function validateLineUp(world: SimWorld, ac: Aircraft): Validation {
  const base = checkGame(world) ?? requireType(ac, 'DEPARTURE', 'line up') ?? requireStatus(ac, 'HOLDING', 'line up');
  if (base) return base;
  if (!ac.holdingPointId) return reject(`${ac.callsign} is not at a runway holding point.`);
  return checkRunway(world, ac) ?? { ok: true };
}

export function validateTakeoff(world: SimWorld, ac: Aircraft): Validation {
  const base = checkGame(world) ?? requireType(ac, 'DEPARTURE', 'takeoff clearance') ?? requireStatus(ac, 'LINE_UP', 'takeoff clearance');
  if (base) return base;
  if (ac.nav.path) return reject(`${ac.callsign} is still lining up.`);
  const heading = fromAngle(world.routes.layout.departureRunway.heading);
  if (dot(fromAngle(ac.heading), heading) < 0.99) return reject(`${ac.callsign} is not aligned with the runway.`);
  return checkRunway(world, ac) ?? { ok: true };
}

export function validateHold(world: SimWorld, ac: Aircraft): Validation {
  const base = checkGame(world) ?? requireStatus(ac, 'TAXIING', 'hold position');
  if (base) return base;
  return ac.taxiHold ? reject(`${ac.callsign} is already holding position.`) : { ok: true };
}

export function validateContinue(world: SimWorld, ac: Aircraft): Validation {
  const base = checkGame(world) ?? requireStatus(ac, 'TAXIING', 'continue taxi');
  if (base) return base;
  return ac.taxiHold ? { ok: true } : reject(`${ac.callsign} is not holding position.`);
}

export function validateCommand(world: SimWorld, cmd: Command): Validation {
  const ac = world.getAircraft(cmd.aircraftId);
  if (!ac) return reject(`Unknown aircraft ${cmd.aircraftId}.`);
  switch (cmd.type) {
    case 'LAND':
      return validateLand(world, ac);
    case 'PUSHBACK':
      return validatePushback(world, ac);
    case 'TAXI':
      return validateTaxi(world, ac, cmd.destinationId);
    case 'LINE_UP':
      return validateLineUp(world, ac);
    case 'TAKEOFF':
      return validateTakeoff(world, ac);
    case 'HOLD':
      return validateHold(world, ac);
    case 'CONTINUE':
      return validateContinue(world, ac);
  }
}

/** Executes a command that already passed validation. Returns the clearance text. */
export function executeCommand(world: SimWorld, cmd: Command, validation: Validation & { ok: true }): string {
  const ac = world.getAircraft(cmd.aircraftId);
  if (!ac) throw new Error(`Unknown aircraft ${cmd.aircraftId}`);
  const emit = world.emit.bind(world);
  const rwy = runwayOf(ac, world.routes.layout).designators[0];
  switch (cmd.type) {
    case 'LAND': {
      transition(ac, 'LANDING', emit);
      // The stack level is released by compactHoldingStack once the aircraft is clear below it.
      assignPath(ac, planLanding(ac, world.routes.layout), 'approach', SIM_CONFIG.air.touchdownSpeed);
      ac.waitTime = 0;
      return `${ac.callsign}, cleared to land runway ${rwy}.`;
    }
    case 'PUSHBACK': {
      if (!ac.gateId) throw new Error('PUSHBACK executed without a gate');
      const gate = world.routes.label(ac.gateId);
      const { path, apronNodeId, endPoint } = planPushback(ac.gateId, world.routes);
      transition(ac, 'PUSHBACK', emit);
      ac.pushback = { apronNodeId, endPoint };
      assignPath(ac, path, 'pushback', 0, true);
      ac.waitTime = 0;
      return `${ac.callsign}, pushback approved from ${gate}.`;
    }
    case 'TAXI': {
      const route = validation.route;
      if (!route) throw new Error('TAXI executed without a validated route');
      ac.destinationId = cmd.destinationId;
      ac.waitTime = 0;
      const inProgress = (ac.status === 'LANDED' && ac.nav.kind === 'rollout') || (ac.status === 'PUSHBACK' && ac.nav.kind === 'pushback');
      if (inProgress) {
        ac.pendingRoute = route;
        ac.routeNodeIds = route;
        // Keep rolling into the taxi route after a landing; a pushback must stop before moving forward.
        if (ac.status === 'LANDED') ac.nav.endSpeed = SIM_CONFIG.ground.exitHandoffSpeed;
      } else {
        beginTaxi(world, ac, route);
      }
      const via = world.routes.describeRoute(route);
      return `${ac.callsign}, taxi to ${world.routes.label(cmd.destinationId)}${via ? ` via ${via}` : ''}.`;
    }
    case 'LINE_UP': {
      if (!ac.holdingPointId) throw new Error('LINE_UP executed away from a holding point');
      transition(ac, 'LINE_UP', emit);
      assignPath(ac, planLineUp(ac.holdingPointId, world.routes), 'lineup', 0);
      ac.holdingPointId = null;
      ac.onRunway = true;
      ac.waitTime = 0;
      return `${ac.callsign}, line up and wait runway ${rwy}.`;
    }
    case 'TAKEOFF': {
      transition(ac, 'TAKEOFF', emit);
      assignPath(ac, planTakeoff(ac, world.routes.layout), 'takeoff', SIM_CONFIG.departure.climbSpeed);
      ac.waitTime = 0;
      return `${ac.callsign}, runway ${rwy}, cleared for takeoff.`;
    }
    case 'HOLD': {
      ac.taxiHold = true;
      return `${ac.callsign}, hold position.`;
    }
    case 'CONTINUE': {
      ac.taxiHold = false;
      return `${ac.callsign}, continue taxi.`;
    }
  }
}

const SIMPLE_LABELS: Record<SimpleCommandType, string> = {
  LAND: 'Clear to land',
  PUSHBACK: 'Approve pushback',
  LINE_UP: 'Line up and wait',
  TAKEOFF: 'Clear for takeoff',
  HOLD: 'Hold position',
  CONTINUE: 'Continue taxi',
};

const SIMPLE_VALIDATORS: Record<SimpleCommandType, (world: SimWorld, ac: Aircraft) => Validation> = {
  LAND: validateLand,
  PUSHBACK: validatePushback,
  LINE_UP: validateLineUp,
  TAKEOFF: validateTakeoff,
  HOLD: validateHold,
  CONTINUE: validateContinue,
};

function simpleOption(world: SimWorld, ac: Aircraft, type: SimpleCommandType): CommandOption {
  const v = SIMPLE_VALIDATORS[type](world, ac);
  return v.ok ? { type, label: SIMPLE_LABELS[type], enabled: true } : { type, label: SIMPLE_LABELS[type], enabled: false, reason: v.reason };
}

function taxiOption(world: SimWorld, ac: Aircraft): CommandOption {
  const { layout } = world.routes;
  const ids = ac.flightType === 'ARRIVAL' ? layout.gateIds : layout.holdingPointIds;
  const destinations: DestinationOption[] = ids.map((id) => {
    const v = validateTaxi(world, ac, id);
    const label = world.routes.label(id);
    return v.ok ? { id, label, enabled: true } : { id, label, enabled: false, reason: v.reason };
  });
  const label = ac.flightType === 'ARRIVAL' ? 'Taxi to gate' : 'Taxi to holding point';
  return destinations.some((d) => d.enabled)
    ? { type: 'TAXI', label, enabled: true, destinations }
    : { type: 'TAXI', label, enabled: false, reason: destinations[0]?.reason ?? 'No destination available.', destinations };
}

/** Every command relevant to the aircraft, in flow order, with whether it is currently allowed. */
export function getCommandOptions(world: SimWorld, ac: Aircraft): CommandOption[] {
  // Hold and continue share one slot: whichever applies right now.
  const hold = simpleOption(world, ac, ac.taxiHold ? 'CONTINUE' : 'HOLD');
  if (ac.flightType === 'ARRIVAL') return [simpleOption(world, ac, 'LAND'), taxiOption(world, ac), hold];
  return [simpleOption(world, ac, 'PUSHBACK'), taxiOption(world, ac), hold, simpleOption(world, ac, 'LINE_UP'), simpleOption(world, ac, 'TAKEOFF')];
}
