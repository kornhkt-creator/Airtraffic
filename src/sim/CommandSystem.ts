import type { Aircraft, Command, CommandType } from './types';
import type { SimWorld } from './world';
import { SIM_CONFIG } from './config';
import { transition } from './aircraft/AircraftStateMachine';
import { assignPath } from './aircraft/MovementSystem';
import { beginTaxi } from './aircraft/AircraftAI';
import { planLanding } from './aircraft/navigation';
import { isRunwayAvailableFor } from './safety/SafetySystem';

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

function checkGame(world: SimWorld): Validation | null {
  if (world.status !== 'RUNNING' && world.status !== 'PAUSED') return reject('The game is not running.');
  return null;
}

export function validateLand(world: SimWorld, ac: Aircraft): Validation {
  const game = checkGame(world);
  if (game) return game;
  if (ac.flightType !== 'ARRIVAL') return reject(`${ac.callsign} is a departure and cannot be cleared to land.`);
  if (ac.status !== 'APPROACH') return reject(`${ac.callsign} is ${ac.status} — landing clearance requires APPROACH.`);
  const runway = isRunwayAvailableFor(world.aircraft, ac);
  if (!runway.ok) return reject(`Runway ${world.routes.layout.runway.id} is occupied by ${runway.occupant.callsign}.`);
  return { ok: true };
}

/** Node the aircraft's next ground route has to start from, or a reason it cannot taxi. */
function taxiStartNode(ac: Aircraft): { node: string } | { reason: string } {
  if (ac.status === 'LANDED') {
    if (!ac.exitNodeId) return { reason: `${ac.callsign} has no runway exit assigned yet.` };
    return { node: ac.exitNodeId };
  }
  return { reason: `${ac.callsign} is ${ac.status} — taxi clearance requires LANDED.` };
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
  const blocker = world.aircraft.find((a) => a.id !== ac.id && (a.gateId === destinationId || a.destinationId === destinationId));
  if (blocker) return reject(`${routes.label(destinationId)} is ${blocker.gateId === destinationId ? 'occupied' : 'reserved'} by ${blocker.callsign}.`);
  const route = routes.findRoute(start.node, destinationId);
  if (!route || route.length < 2) return reject(`No valid taxi route to ${routes.label(destinationId)}.`);
  return { ok: true, route };
}

export function validateCommand(world: SimWorld, cmd: Command): Validation {
  const ac = world.getAircraft(cmd.aircraftId);
  if (!ac) return reject(`Unknown aircraft ${cmd.aircraftId}.`);
  switch (cmd.type) {
    case 'LAND':
      return validateLand(world, ac);
    case 'TAXI':
      return validateTaxi(world, ac, cmd.destinationId);
  }
}

/** Executes a command that already passed validation. Returns the clearance text. */
export function executeCommand(world: SimWorld, cmd: Command, validation: Validation & { ok: true }): string {
  const ac = world.getAircraft(cmd.aircraftId);
  if (!ac) throw new Error(`Unknown aircraft ${cmd.aircraftId}`);
  switch (cmd.type) {
    case 'LAND': {
      transition(ac, 'LANDING', (e) => world.emit(e));
      assignPath(ac, planLanding(ac, world.routes.layout), 'approach', SIM_CONFIG.air.touchdownSpeed);
      ac.waitTime = 0;
      return `${ac.callsign}, cleared to land runway ${world.routes.layout.runway.designators[0]}.`;
    }
    case 'TAXI': {
      const route = validation.route;
      if (!route) throw new Error('TAXI executed without a validated route');
      ac.destinationId = cmd.destinationId;
      ac.waitTime = 0;
      if (ac.nav.kind === 'rollout') {
        ac.pendingRoute = route;
        ac.routeNodeIds = route;
        ac.nav.endSpeed = SIM_CONFIG.ground.exitHandoffSpeed;
      } else {
        beginTaxi(world, ac, route);
      }
      const via = world.routes.describeRoute(route);
      return `${ac.callsign}, taxi to ${world.routes.label(cmd.destinationId)}${via ? ` via ${via}` : ''}.`;
    }
  }
}

/** Every command for the aircraft with whether it is currently allowed (used by the command panel). */
export function getCommandOptions(world: SimWorld, ac: Aircraft): CommandOption[] {
  const land = validateLand(world, ac);
  const destinations: DestinationOption[] = world.routes.layout.gateIds.map((id) => {
    const v = validateTaxi(world, ac, id);
    return v.ok
      ? { id, label: world.routes.label(id), enabled: true }
      : { id, label: world.routes.label(id), enabled: false, reason: v.reason };
  });
  const firstEnabled = destinations.some((d) => d.enabled);
  const taxiReason = destinations[0]?.reason;
  const options: CommandOption[] = [
    land.ok ? { type: 'LAND', label: 'Clear to land', enabled: true } : { type: 'LAND', label: 'Clear to land', enabled: false, reason: land.reason },
    firstEnabled
      ? { type: 'TAXI', label: 'Taxi to gate', enabled: true, destinations }
      : { type: 'TAXI', label: 'Taxi to gate', enabled: false, reason: taxiReason ?? 'No gate available.', destinations },
  ];
  return options;
}
