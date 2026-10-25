import { useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group } from 'three';
import { useGame } from '../game/GameContext';
import { angleDiff, clamp, lerp, lerpAngle } from '../sim/math';
import type { AircraftStatus } from '../sim/types';
import { SIM_CONFIG } from '../sim/config';

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

/** Procedural low-poly airliner built along +X (nose), ~38 m long. */
function AirlinerMesh({ accent }: { accent: string }) {
  return (
    <group position={[0, 3.6, 0]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[2, 2, 30, 14]} />
        <meshStandardMaterial color="#f5f6f8" />
      </mesh>
      <mesh position={[16, 0, 0]} scale={[2.2, 1, 1]} castShadow>
        <sphereGeometry args={[2, 14, 10]} />
        <meshStandardMaterial color="#f5f6f8" />
      </mesh>
      <mesh position={[17.8, 0.6, 0]} scale={[0.8, 0.5, 1.4]}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#26323d" />
      </mesh>
      <mesh position={[-18.5, 0.4, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <coneGeometry args={[2, 7, 14]} />
        <meshStandardMaterial color="#f5f6f8" />
      </mesh>
      <mesh position={[1, -0.8, 0]} castShadow>
        <boxGeometry args={[7, 0.5, 34]} />
        <meshStandardMaterial color="#dfe3e8" />
      </mesh>
      <mesh position={[-18.5, 1.4, 0]} castShadow>
        <boxGeometry args={[3.5, 0.35, 12]} />
        <meshStandardMaterial color="#dfe3e8" />
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
}

export function AircraftModel({ id, callsign, status, selected, showLabel }: Props) {
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

    // Keep distant airborne aircraft readable; ground traffic stays near true size so it fits the taxiways.
    const distance = state.camera.position.distanceTo(g.position);
    const boost = clamp(distance / 1800, 1, alt > 30 ? 6 : 1.6);
    const scale = MODEL_SCALE * boost;
    g.scale.setScalar(scale);

    // Float the callsign just above the aircraft's on-screen footprint so it never covers it.
    if (label.current) {
      const fov = 'fov' in state.camera ? (state.camera.fov as number) : 45;
      const pxPerMeter = state.size.height / (2 * Math.tan((fov * Math.PI) / 360) * Math.max(distance, 1));
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
        <AirlinerMesh accent={accent} />
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
      {(showLabel || selected || hovered) && (
        <Html zIndexRange={[20, 0]}>
          <button
            ref={label}
            type="button"
            className={`ac-label st-${status.toLowerCase().replace('_', '-')} ${selected ? 'selected' : ''}`}
            onClick={() => controller.select(id)}
          >
            {callsign}
          </button>
        </Html>
      )}
    </group>
  );
}
