import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { useGame, useGameStore } from '../game/GameContext';
import { AIRPORT } from '../sim/airport/layout';
import { arrivalRoute, glideAltitude } from '../sim/aircraft/navigation';
import { SIM_CONFIG } from '../sim/config';

/** Planned route of the selected aircraft. */
export function SelectedRoute() {
  const controller = useGame();
  const selectedId = useGameStore((s) => s.selectedId);
  const routeKey = useGameStore((s) => {
    const a = s.snapshot.aircraft.find((v) => v.id === s.selectedId);
    return a ? `${a.id}:${a.pathVersion}:${a.status}:${a.target}` : null;
  });

  const points = useMemo(() => {
    if (!selectedId || !routeKey) return null;
    const route = controller.sim.getPlannedRoute(selectedId);
    if (route.length < 2) return null;
    return route.map((p) => [p.x, p.alt + 1.2, -p.y] as [number, number, number]);
  }, [controller, selectedId, routeKey]);

  if (!points) return null;
  return <Line points={points} color="#22d3ee" lineWidth={3} dashed dashSize={18} gapSize={10} />;
}

/** Always-visible guidance: the holding pattern and the arrival route to each runway. */
export function ApproachGuides() {
  const controller = useGame();
  const holding = useMemo(
    () =>
      controller.sim.holdingLoop
        .samplePoints(100)
        .map(({ position }) => [position.x, SIM_CONFIG.air.holdingAltitude, -position.y] as [number, number, number]),
    [controller],
  );
  // The arrival route flown after a landing clearance, one line per runway (downwind and base are shared).
  const routes = useMemo(
    () =>
      AIRPORT.runways.map((runway) => {
        const path = arrivalRoute(runway);
        return {
          id: runway.id,
          points: path.samplePoints(40).map(({ s, position }) => [position.x, glideAltitude(path.length - s) + 0.5, -position.y] as [number, number, number]),
        };
      }),
    [],
  );
  return (
    <group>
      <Line points={holding} color="#ffffff" lineWidth={1.5} transparent opacity={0.45} dashed dashSize={40} gapSize={28} />
      {routes.map((r) => (
        <Line key={r.id} points={r.points} color="#fde68a" lineWidth={1.5} transparent opacity={0.55} dashed dashSize={60} gapSize={40} />
      ))}
    </group>
  );
}
