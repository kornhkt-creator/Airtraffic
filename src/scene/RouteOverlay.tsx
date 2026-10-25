import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { useGame, useGameStore } from '../game/GameContext';
import { AIRPORT } from '../sim/airport/layout';
import { glideAltitude } from '../sim/aircraft/navigation';
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

/** Always-visible guidance: the holding pattern and the final approach path to runway 09. */
export function ApproachGuides() {
  const controller = useGame();
  const holding = useMemo(
    () =>
      controller.sim.holdingLoop
        .samplePoints(100)
        .map(({ position }) => [position.x, SIM_CONFIG.air.holdingAltitude, -position.y] as [number, number, number]),
    [controller],
  );
  const final = useMemo(() => {
    const { faf } = AIRPORT.approach;
    const td = AIRPORT.runway.touchdown;
    const total = td.x - faf.x;
    const pts: [number, number, number][] = [];
    for (let k = 0; k <= 20; k++) {
      const x = faf.x + (total * k) / 20;
      pts.push([x, glideAltitude(td.x - x) + 0.5, 0]);
    }
    return pts;
  }, []);
  return (
    <group>
      <Line points={holding} color="#ffffff" lineWidth={1.5} transparent opacity={0.45} dashed dashSize={60} gapSize={40} />
      <Line points={final} color="#fde68a" lineWidth={1.5} transparent opacity={0.55} dashed dashSize={60} gapSize={40} />
    </group>
  );
}
