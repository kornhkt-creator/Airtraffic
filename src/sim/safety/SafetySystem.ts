import type { Aircraft } from '../types';
import type { AirportLayout, RunwayDef } from '../airport/layout';

/**
 * Segregated runway operations (simplified game rule, not real ATC procedure): arrivals use only
 * the arrival runway and departures only the departure runway. A runway is occupied by any of its
 * aircraft cleared to land, or any of its aircraft physically on it.
 */
export function runwayOf(ac: Aircraft, layout: AirportLayout): RunwayDef {
  return ac.flightType === 'ARRIVAL' ? layout.arrivalRunway : layout.departureRunway;
}

export function getRunwayOccupants(aircraft: readonly Aircraft[], runway: RunwayDef, layout: AirportLayout): Aircraft[] {
  return aircraft.filter((a) => runwayOf(a, layout).id === runway.id && (a.status === 'LANDING' || a.onRunway));
}

export function isRunwayAvailableFor(aircraft: readonly Aircraft[], candidate: Aircraft, layout: AirportLayout): { ok: true } | { ok: false; occupant: Aircraft } {
  const occupant = getRunwayOccupants(aircraft, runwayOf(candidate, layout), layout).find((a) => a.id !== candidate.id);
  return occupant ? { ok: false, occupant } : { ok: true };
}
