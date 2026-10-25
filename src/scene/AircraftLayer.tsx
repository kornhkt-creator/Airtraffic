import { useGameStore } from '../game/GameContext';
import { AircraftModel } from './AircraftModel';

export function AircraftLayer() {
  const aircraft = useGameStore((s) => s.snapshot.aircraft);
  const selectedId = useGameStore((s) => s.selectedId);
  return (
    <group>
      {aircraft.filter((a) => a.status !== 'DEPARTED').map((a) => (
        <AircraftModel key={a.id} id={a.id} callsign={a.callsign} status={a.status} selected={a.id === selectedId} />
      ))}
    </group>
  );
}
