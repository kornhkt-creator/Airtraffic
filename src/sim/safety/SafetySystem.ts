import type { Aircraft } from '../types';

/**
 * Runway occupancy rule (simplified game rule, not real ATC procedure):
 * the runway is occupied by any aircraft cleared to land, or any aircraft physically on it.
 */
export function getRunwayOccupants(aircraft: readonly Aircraft[]): Aircraft[] {
  return aircraft.filter((a) => a.status === 'LANDING' || a.onRunway);
}

export function isRunwayAvailableFor(aircraft: readonly Aircraft[], candidate: Aircraft): { ok: true } | { ok: false; occupant: Aircraft } {
  const occupant = getRunwayOccupants(aircraft).find((a) => a.id !== candidate.id);
  return occupant ? { ok: false, occupant } : { ok: true };
}
