import { useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group, Mesh, MeshBasicMaterial } from 'three';
import { useGame } from '../game/GameContext';
import { angleDiff, clamp, lerp, lerpAngle } from '../sim/math';
import type { AircraftStatus } from '../sim/types';
import { SIM_CONFIG } from '../sim/config';
import type { StaticStand } from '../sim/airport/layout';

const LIVERY: Record<string, string> = {
  SKL: '#1e88e5',
  AZR: '#00897b',
  NVX: '#5e35b1',
  ORB: '#f4511e',
  PLM: '#43a047',
  KTA: '#e53935',
  VRN: '#fb8c00',
  HLX: '#3949ab',
};

/** Procedural low-poly airliner built along +X (nose), ~38 m long. A charred one is a burnt-out wreck. */
export function AirlinerMesh({ accent: livery, charred = false }: { accent: string; charred?: boolean }) {
  const hull = charred ? '#2a2725' : '#f5f6f8';
  const wing = charred ? '#3a3633' : '#dfe3e8';
  const accent = charred ? '#4a2b1c' : livery;
  return (
    <group position={[0, 3.6, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[2, 2, 30, 14]} />
        <meshStandardMaterial color={hull} />
      </mesh>
      <mesh position={[16, 0, 0]} scale={[2.2, 1, 1]} castShadow>
        <sphereGeometry args={[2, 14, 10]} />
        <meshStandardMaterial color={hull} />
      </mesh>
      <mesh position={[17.8, 0.6, 0]} scale={[0.8, 0.5, 1.4]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#26323d" />
      </mesh>
      <mesh position={[-18.5, 0.4, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <coneGeometry args={[2, 7, 14]} />
        <meshStandardMaterial color={hull} />
      </mesh>
      <mesh position={[1, -0.8, 0]} castShadow>
        <boxGeometry args={[7, 0.5, 34]} />
        <meshStandardMaterial color={wing} />
      </mesh>
      <mesh position={[-18.5, 1.4, 0]} castShadow>
        <boxGeometry args={[3.5, 0.35, 12]} />
        <meshStandardMaterial color={wing} />
      </mesh>
      <mesh position={[-18.5, 4.8, 0]} castShadow>
        <boxGeometry args={[5, 7, 0.5]} />
        <meshStandardMaterial color={accent} />
      </mesh>
      <mesh position={[0, -0.2, 0]}>
        <boxGeometry args={[28, 0.6, 4.05]} />
        <meshStandardMaterial color={accent} />
      </mesh>
      {[-7, 7].map((z) => (
        <mesh key={z} position={[3, -1.9, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[1.1, 1.1, 4.5, 12]} />
          <meshStandardMaterial color="#9aa3ad" />
        </mesh>
      ))}
    </group>
  );
}


/** The procedural mesh is ~38 m long; scale it to the configured game aircraft size. */
const MODEL_SCALE = SIM_CONFIG.aircraft.length / 38;
const MODEL_HALF_LENGTH = 19;

interface Props {
  id: string;
  callsign: string;
  status: AircraftStatus;
  selected: boolean;
  showLabel: boolean;
  /** Another aircraft is dangerously close: pulse a red warning ring. */
  conflict: boolean;
}

export function AircraftModel({ id, callsign, status, selected, showLabel, conflict }: Props) {
  const warning = useRef<Mesh>(null);
  const crashed = status === 'CRASHED';
  const controller = useGame();
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const label = useRef<HTMLButtonElement>(null);
  const lastHeading = useRef<number | null>(null);
  const bank = useRef(0);
  const [hovered, setHovered] = useState(false);
  const accent = LIVERY[callsign.slice(0, 3)] ?? '#1e88e5';

  useFrame((state, delta) => {
    const ac = controller.sim.getAircraft(id);
    const g = root.current;
    if (!ac || !g) return;
    const alpha = controller.sim.status === 'RUNNING' ? controller.sim.clock.alpha : 1;
    const x = lerp(ac.prev.position.x, ac.position.x, alpha);
    const y = lerp(ac.prev.position.y, ac.position.y, alpha);
    const alt = lerp(ac.prev.altitude, ac.altitude, alpha);
    const heading = lerpAngle(ac.prev.heading, ac.heading, alpha);
    g.position.set(x, alt + 0.3, -y);
    g.rotation.y = heading;

    // Bank into turns while airborne (visual only).
    const turnRate = lastHeading.current === null || delta <= 0 ? 0 : angleDiff(lastHeading.current, heading) / delta;
    lastHeading.current = heading;
    const targetBank = alt > 5 ? clamp(Math.atan((ac.speed * turnRate) / 9.81), -0.5, 0.5) : 0;
    bank.current = lerp(bank.current, targetBank, Math.min(1, delta * 3));
    if (body.current) {
      body.current.rotation.x = -bank.current;
      body.current.rotation.z = ac.status === 'LANDING' && alt > 2 ? 0.03 : 0;
    }

    // Ground traffic stays true to size so it fits the stands; climbing aircraft grow a little to read as higher.
    const pxPerMeter = state.camera.zoom;
    const scale = MODEL_SCALE * (1 + clamp(alt / 600, 0, 1) * 0.35);
    g.scale.setScalar(scale);

    if (warning.current) {
      const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 9);
      (warning.current.material as MeshBasicMaterial).opacity = 0.35 + 0.6 * pulse;
      warning.current.scale.setScalar(1 + 0.12 * pulse);
    }

    // Float the callsign just above the aircraft's on-screen footprint so it never covers it.
    if (label.current) {
      const offset = clamp(MODEL_HALF_LENGTH * scale * pxPerMeter, 4, 160) + 6;
      label.current.style.transform = `translate(-50%, calc(-100% - ${offset.toFixed(1)}px))`;
    }
  });

  const select = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    controller.select(id);
  };

  return (
    <group ref={root}>
      <group
        ref={body}
        onClick={select}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = '';
        }}
      >
        {/* A wreck sits skewed on its belly. */}
        <group rotation={crashed ? [0.12, 0.5, -0.08] : [0, 0, 0]} position={crashed ? [0, -1.5, 0] : [0, 0, 0]}>
          <AirlinerMesh accent={accent} charred={crashed} />
        </group>
        {/* Invisible, larger hit box makes small aircraft easy to click. */}
        <mesh visible={false}>
          <boxGeometry args={[44, 14, 40]} />
        </mesh>
      </group>
      {(selected || hovered) && (
        <mesh position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[24, 26.5, 48]} />
          <meshBasicMaterial color={selected ? '#22d3ee' : '#ffffff'} transparent opacity={0.9} />
        </mesh>
      )}
      {conflict && !crashed && (
        <mesh ref={warning} position={[0, 0.45, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[27, 31, 48]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.9} />
        </mesh>
      )}
      {(showLabel || selected || hovered) && (
        <Html zIndexRange={[20, 0]}>
          <button
            ref={label}
            type="button"
            className={`ac-label st-${status.toLowerCase().replace('_', '-')} ${selected ? 'selected' : ''} ${conflict ? 'conflict' : ''}`}
            onClick={() => controller.select(id)}
          >
            {callsign}
          </button>
        </Html>
      )}
    </group>
  );
}

/** Parked scenery aircraft (not part of the simulation). */
export function StaticAircraft({ stands }: { stands: readonly StaticStand[] }) {
  const liveries = Object.values(LIVERY);
  return (
    <group>
      {stands.map((s, i) => (
        <group key={i} position={[s.position.x, 0.3, -s.position.y]} rotation={[0, s.heading, 0]} scale={MODEL_SCALE}>
          <AirlinerMesh accent={liveries[(i * 5) % liveries.length]!} />
        </group>
      ))}
    </group>
  );
}
