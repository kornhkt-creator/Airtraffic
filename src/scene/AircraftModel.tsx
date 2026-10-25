import { useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Group } from 'three';
import { useGame } from '../game/GameContext';
import { angleDiff, clamp, lerp, lerpAngle } from '../sim/math';
import type { AircraftStatus } from '../sim/types';

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


interface Props {
  id: string;
  callsign: string;
  status: AircraftStatus;
  selected: boolean;
}

export function AircraftModel({ id, callsign, status, selected }: Props) {
  const controller = useGame();
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
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

    // Keep distant aircraft readable.
    const distance = state.camera.position.distanceTo(g.position);
    g.scale.setScalar(clamp(distance / 900, 1, 10));
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
          <ringGeometry args={[24, 27, 48]} />
          <meshBasicMaterial color={selected ? '#22d3ee' : '#ffffff'} transparent opacity={0.9} />
        </mesh>
      )}
      <Html position={[0, 16, 0]} center zIndexRange={[20, 0]}>
        <button
          type="button"
          className={`ac-label st-${status.toLowerCase().replace('_', '-')} ${selected ? 'selected' : ''}`}
          onClick={() => controller.select(id)}
        >
          {callsign}
        </button>
      </Html>
    </group>
  );
}
