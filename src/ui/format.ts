import type { AircraftStatus } from '../sim/types';

export function formatClock(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const STATUS_LABEL: Record<AircraftStatus, string> = {
  APPROACH: 'Approach',
  LANDING: 'Landing',
  GO_AROUND: 'Go-around',
  LANDED: 'Landed',
  TAXIING: 'Taxiing',
  HOLDING: 'Holding',
  AT_GATE: 'At gate',
  PUSHBACK: 'Pushback',
  LINE_UP: 'Line up',
  TAKEOFF: 'Takeoff',
  DEPARTED: 'Departed',
  DIVERTED: 'Diverted',
  CRASHED: 'Crashed',
};

export const statusClass = (status: AircraftStatus): string => `badge st-${status.toLowerCase().replace('_', '-')}`;
