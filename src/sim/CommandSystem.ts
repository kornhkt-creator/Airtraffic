import type { Aircraft, Command, CommandType, SimpleCommandType } from './types';
import type { SimWorld } from './world';
import type { RunwayDef } from './airport/layout';
import { SIM_CONFIG } from './config';
import { distance, dot, fromAngle, normalize, sub } from './math';
import { transition } from './aircraft/AircraftStateMachine';
import { assignPath } from './aircraft/MovementSystem';
import { beginTaxi } from './aircraft/AircraftAI';
import { apronNodeOf, planGoAround, planLanding, planLineUp, planPushback, planTakeoff, runwayEntryOf } from './aircraft/navigation';
import { getRunwayOccupants, isRunwayAvailableFor, runwayOf } from './safety/SafetySystem';
import { freeHoldingLevel, levelAltitude } from './aircraft/holdingStack';

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

/** Runway a LAND clearance refers to (default: the arrival runway), or null if unknown. */
function landingRunway(world: SimWorld, runwayId?: string): RunwayDef | null {
  const { layout } = world.routes;
  return runwayId === undefined ? layout.arrivalRunway : (layout.runways.find((r) => r.id === runwayId) ?? null);
}

export function validateLand(world: SimWorld, ac: Aircraft, runwayId?: string): Validation {
  const runway = landingRunway(world, runwayId);
  if (!runway) return reject(`Unknown runway ${runwayId}.`);
  const base = checkGame(world) ?? requireType(ac, 'ARRIVAL', 'landing clearance') ?? requireStatus(ac, 'APPROACH', 'landing clearance');
  if (base) return base;
  // Only the bottom of the holding stack can make the glide path in time.
  if ((ac.holdingLevel ?? 0) > 0) return reject(`${ac.callsign} is at holding level ${(ac.holdingLevel ?? 0) + 1} — only the lowest aircraft in the stack can be cleared to land.`);
  if (ac.altitude > levelAltitude(0) + SIM_CONFIG.air.landingAltitudeTolerance) return reject(`${ac.callsign} is still descending to the bottom of the holding stack.`);
  const occupant = getRunwayOccupants(world.aircraft, runway, world.routes.layout).find((a) => a.id !== ac.id);
  return occupant ? reject(`Runway ${runway.designators[0]} is occupied by ${occupant.callsign}.`) : { ok: true };
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
  // Gates take one aircraft; holding points queue departures (ground follow logic keeps the spacing).
  const blocker = dest.kind === 'gate' ? world.aircraft.find((a) => a.id !== ac.id && (a.gateId === destinationId || a.destinationId === destinationId)) : undefined;
  if (blocker) {
    const occupied = blocker.gateId === destinationId;
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
  return checkLineUpRunway(world, ac, ac.holdingPointId) ?? { ok: true };
}

/**
 * Line up and wait is allowed behind a departure that is already rolling (or climbing) further down
 * the runway; TAKEOFF then waits until that traffic is clear. Lining up anywhere else on an occupied
 * runway — in particular in front of an aircraft on its takeoff roll — would be a runway incursion.
 */
function checkLineUpRunway(world: SimWorld, ac: Aircraft, holdingPointId: string): Validation | null {
  const { layout } = world.routes;
  const runway = runwayOf(ac, layout);
  const dir = fromAngle(runway.heading);
  const entry = world.routes.node(runwayEntryOf(holdingPointId, world.routes)).position;
  const lineUpPoint = { x: entry.x + dir.x * SIM_CONFIG.ground.lineUpDistance, y: entry.y + dir.y * SIM_CONFIG.ground.lineUpDistance };
  const minLead = SIM_CONFIG.aircraft.length * 2;
  for (const occ of getRunwayOccupants(world.aircraft, runway, layout)) {
    if (occ.id === ac.id) continue;
    const lead = dot(sub(occ.position, lineUpPoint), dir);
    if (occ.status === 'TAKEOFF' && lead > minLead) continue;
    if (occ.status === 'TAKEOFF' && lead < 0) {
      return reject(`${occ.callsign} is on its takeoff roll toward ${world.routes.label(holdingPointId)} — lining up in front of it would be a runway incursion.`);
    }
    return reject(`Runway ${runway.designators[0]} is occupied by ${occ.callsign}.`);
  }
  return null;
}

export function validateGoAround(world: SimWorld, ac: Aircraft): Validation {
  return checkGame(world) ?? requireType(ac, 'ARRIVAL', 'a go-around') ?? requireStatus(ac, 'LANDING', 'a go-around') ?? { ok: true };
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
      return validateLand(world, ac, cmd.runwayId);
    case 'PUSHBACK':
      return validatePushback(world, ac);
    case 'TAXI':
      return validateTaxi(world, ac, cmd.destinationId);
    case 'LINE_UP':
      return validateLineUp(world, ac);
    case 'TAKEOFF':
      return validateTakeoff(world, ac);
    case 'GO_AROUND':
      return validateGoAround(world, ac);
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
      // The holding (fuel) clock is not reset: a go-around returns to the hold with what it had used.
      const runway = landingRunway(world, cmd.runwayId);
      if (!runway) throw new Error('LAND executed for an unknown runway');
      ac.runwayId = runway.id;
      assignPath(ac, planLanding(ac, runway, world.routes.layout), 'approach', SIM_CONFIG.air.touchdownSpeed);
      return `${ac.callsign}, cleared to land runway ${runway.designators[0]}.`;
    }
    case 'GO_AROUND': {
      transition(ac, 'GO_AROUND', emit);
      // Keep the stack level if it still has one; otherwise take a free one (or wait above the stack).
      if (ac.holdingLevel === null) ac.holdingLevel = freeHoldingLevel(world.aircraft);
      assignPath(ac, planGoAround(ac, world.holdingLoop), 'goaround', SIM_CONFIG.air.approachSpeed);
      return `${ac.callsign}, go around — climb straight ahead, then rejoin the hold.`;
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
      const sequence = departureSequence(world, ac, cmd.destinationId);
      const queue = sequence > 1 ? `, number ${sequence} for departure` : '';
      return `${ac.callsign}, taxi to ${world.routes.label(cmd.destinationId)}${via ? ` via ${via}` : ''}${queue}.`;
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
  GO_AROUND: 'Go around',
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
  GO_AROUND: validateGoAround,
  HOLD: validateHold,
  CONTINUE: validateContinue,
};

function simpleOption(world: SimWorld, ac: Aircraft, type: SimpleCommandType): CommandOption {
  const v = SIMPLE_VALIDATORS[type](world, ac);
  return v.ok ? { type, label: SIMPLE_LABELS[type], enabled: true } : { type, label: SIMPLE_LABELS[type], enabled: false, reason: v.reason };
}

/**
 * Position this aircraft would take in the departure queue for a holding point: 1 + everyone already
 * waiting there or taxiing to it.
 */
export function departureSequence(world: SimWorld, ac: Aircraft, holdingPointId: string): number {
  return 1 + world.aircraft.filter((a) => a.id !== ac.id && (a.holdingPointId === holdingPointId || a.destinationId === holdingPointId)).length;
}

function taxiOption(world: SimWorld, ac: Aircraft): CommandOption {
  const { layout } = world.routes;
  const ids = ac.flightType === 'ARRIVAL' ? layout.gateIds : layout.holdingPointIds;
  const destinations: DestinationOption[] = ids.map((id) => {
    const v = validateTaxi(world, ac, id);
    const queued = ac.flightType === 'DEPARTURE' && ac.destinationId !== id ? departureSequence(world, ac, id) : 1;
    const label = queued > 1 ? `${world.routes.label(id)} (#${queued})` : world.routes.label(id);
    return v.ok ? { id, label, enabled: true } : { id, label, enabled: false, reason: v.reason };
  });
  const label = ac.flightType === 'ARRIVAL' ? 'Taxi to gate' : 'Taxi to holding point';
  return destinations.some((d) => d.enabled)
    ? { type: 'TAXI', label, enabled: true, destinations }
    : { type: 'TAXI', label, enabled: false, reason: destinations[0]?.reason ?? 'No destination available.', destinations };
}

/** LAND with one choice per runway. */
function landOption(world: SimWorld, ac: Aircraft): CommandOption {
  const destinations: DestinationOption[] = world.routes.layout.runways.map((r) => {
    const v = validateLand(world, ac, r.id);
    const label = `RWY ${r.designators[0]}`;
    return v.ok ? { id: r.id, label, enabled: true } : { id: r.id, label, enabled: false, reason: v.reason };
  });
  return destinations.some((d) => d.enabled)
    ? { type: 'LAND', label: SIMPLE_LABELS.LAND, enabled: true, destinations }
    : { type: 'LAND', label: SIMPLE_LABELS.LAND, enabled: false, reason: destinations[0]?.reason ?? 'No runway available.', destinations };
}

/** Every command relevant to the aircraft, in flow order, with whether it is currently allowed. */
export function getCommandOptions(world: SimWorld, ac: Aircraft): CommandOption[] {
  // Hold and continue share one slot: whichever applies right now.
  const hold = simpleOption(world, ac, ac.taxiHold ? 'CONTINUE' : 'HOLD');
  // Landing clearance and go-around share one slot as well.
  if (ac.flightType === 'ARRIVAL') return [ac.status === 'LANDING' ? simpleOption(world, ac, 'GO_AROUND') : landOption(world, ac), taxiOption(world, ac), hold];
  return [simpleOption(world, ac, 'PUSHBACK'), taxiOption(world, ac), hold, simpleOption(world, ac, 'LINE_UP'), simpleOption(world, ac, 'TAKEOFF')];
}
