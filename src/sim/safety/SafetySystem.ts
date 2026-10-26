import type { Aircraft } from '../types';
import type { AirportLayout, RunwayDef } from '../airport/layout';
import { SIM_CONFIG } from '../config';
import { cross, dot, fromAngle, sub } from '../math';

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

/** Whether the aircraft holds a clearance that lets it be on this runway right now. */
function clearedFor(ac: Aircraft, runway: RunwayDef, layout: AirportLayout): boolean {
  if (runwayOf(ac, layout).id !== runway.id) return false;
  return ac.status === 'LANDING' || ac.status === 'LINE_UP' || ac.status === 'TAKEOFF' || (ac.status === 'LANDED' && ac.onRunway);
}

/**
 * Runway incursions: an aircraft on the ground inside a runway strip without a clearance for that
 * runway. Normal taxi routes never enter a runway, so this is a safety net that catches anything
 * reaching a runway by another way.
 */
export function findRunwayIncursions(aircraft: readonly Aircraft[], layout: AirportLayout): { ac: Aircraft; runway: RunwayDef }[] {
  const out: { ac: Aircraft; runway: RunwayDef }[] = [];
  for (const runway of [layout.arrivalRunway, layout.departureRunway]) {
    const dir = fromAngle(runway.heading);
    for (const ac of aircraft) {
      if (ac.altitude > 5 || ac.status === 'CRASHED' || ac.status === 'DEPARTED' || clearedFor(ac, runway, layout)) continue;
      const rel = sub(ac.position, runway.start);
      const along = dot(rel, dir);
      if (along < 0 || along > runway.length) continue;
      if (Math.abs(cross(dir, rel)) < SIM_CONFIG.safety.runwayStripHalfWidth) out.push({ ac, runway });
    }
  }
  return out;
}

export function isRunwayAvailableFor(aircraft: readonly Aircraft[], candidate: Aircraft, layout: AirportLayout): { ok: true } | { ok: false; occupant: Aircraft } {
  const occupant = getRunwayOccupants(aircraft, runwayOf(candidate, layout), layout).find((a) => a.id !== candidate.id);
  return occupant ? { ok: false, occupant } : { ok: true };
}
