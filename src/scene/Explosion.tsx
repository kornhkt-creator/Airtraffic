import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type Group, type Mesh, type MeshBasicMaterial, type PointLight } from 'three';
import { useGameStore } from '../game/GameContext';
import { Rng } from '../sim/rng';
import type { Vec2 } from '../sim/types';
import { clamp } from '../sim/math';

/** Explosion at the collision site once the game ends in a crash. */
export function CrashEffects() {
  const crash = useGameStore((s) => s.snapshot.crash);
  if (!crash) return null;
  return <Explosion key={`${crash.time}:${crash.aircraftIds.join(',')}`} at={crash.position} altitude={crash.altitude} />;
}

const easeOut = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3;

interface Debris {
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  size: number;
}

interface Puff {
  delay: number;
  drift: number;
  size: number;
}

const DEBRIS_COUNT = 28;
const PUFF_COUNT = 36;
const SMOKE_LIFETIME = 7;
/** Smoke drifts downwind (east-north-east), which reads well from the top-down camera. */
const WIND = { x: 9, z: -4 };

/**
 * Fireball, flash, shockwave ring, flying debris, then a burning wreck with a drifting smoke plume.
 * Runs on the render clock (the simulation is stopped at GAME_OVER).
 */
function Explosion({ at, altitude }: { at: Vec2; altitude: number }) {
  const started = useRef<number | null>(null);
  const light = useRef<PointLight>(null);
  const fireballs = useRef<(Mesh | null)[]>([]);
  const ring = useRef<Mesh>(null);
  const debrisRefs = useRef<(Mesh | null)[]>([]);
  const puffRefs = useRef<(Mesh | null)[]>([]);
  const flames = useRef<Group>(null);

  const { debris, puffs } = useMemo(() => {
    const rng = new Rng(Math.round(at.x * 31 + at.y * 17) >>> 0);
    const debris: Debris[] = Array.from({ length: DEBRIS_COUNT }, () => {
      const angle = rng.range(0, Math.PI * 2);
      const speed = rng.range(35, 120);
      return { vx: Math.cos(angle) * speed, vz: Math.sin(angle) * speed, vy: rng.range(25, 70), spin: rng.range(-8, 8), size: rng.range(1.5, 4.5) };
    });
    const puffs: Puff[] = Array.from({ length: PUFF_COUNT }, (_, i) => ({
      delay: 0.15 + (i / PUFF_COUNT) * SMOKE_LIFETIME,
      drift: rng.range(-1, 1),
      size: rng.range(0.8, 1.3),
    }));
    return { debris, puffs };
  }, [at.x, at.y]);

  useFrame((state) => {
    if (started.current === null) started.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - started.current;

    if (light.current) light.current.intensity = t < 1.2 ? 12 * (1 - t / 1.2) ** 2 + 1.5 : 1.5 + Math.sin(t * 17) * 0.4 + Math.sin(t * 7.3) * 0.3;

    // Fireball: three shells that swell, then burn out.
    const radii = [38, 62, 90];
    fireballs.current.forEach((m, i) => {
      if (!m) return;
      const grow = easeOut(t / (0.35 + i * 0.15));
      m.scale.setScalar(Math.max(0.01, radii[i]! * grow));
      (m.material as MeshBasicMaterial).opacity = clamp(1.6 - t * (0.9 - i * 0.15), 0, 0.95);
    });

    if (ring.current) {
      const k = easeOut(t / 1.1);
      ring.current.scale.setScalar(10 + 270 * k);
      (ring.current.material as MeshBasicMaterial).opacity = clamp(0.85 * (1 - t / 1.1), 0, 0.85);
    }

    debris.forEach((d, i) => {
      const m = debrisRefs.current[i];
      if (!m) return;
      // Ballistic until it hits the ground, then it stays as a scattered fragment.
      const g = 40;
      const tLand = (d.vy + Math.sqrt(d.vy * d.vy + 2 * g * (altitude + 2))) / g;
      const tt = Math.min(t, tLand);
      const drag = 1 - Math.exp(-tt * 1.2);
      m.position.set((d.vx / 1.2) * drag, Math.max(0.5, altitude + 2 + d.vy * tt - 0.5 * g * tt * tt), (d.vz / 1.2) * drag);
      m.rotation.set(d.spin * tt, d.spin * 0.7 * tt, 0);
    });

    puffs.forEach((p, i) => {
      const m = puffRefs.current[i];
      if (!m) return;
      // Each puff loops forever after its first emission, so the wreck keeps smoking.
      const age = t - p.delay;
      if (age < 0) {
        m.visible = false;
        return;
      }
      const a = age % SMOKE_LIFETIME;
      const k = a / SMOKE_LIFETIME;
      m.visible = true;
      m.position.set(WIND.x * a + p.drift * 10 * a, 15 + a * 14, WIND.z * a + p.drift * 6 * a);
      m.scale.setScalar(p.size * (16 + 70 * easeOut(k)));
      const fadeIn = clamp(a / 0.6, 0, 1);
      (m.material as MeshBasicMaterial).opacity = 0.3 * fadeIn * (1 - k) ** 1.5;
    });

    if (flames.current) {
      const on = t > 0.6;
      flames.current.visible = on;
      flames.current.children.forEach((c, i) => {
        const s = 8 + Math.sin(t * (9 + i * 2.3) + i) * 3 + Math.sin(t * (21 + i)) * 1.5;
        c.scale.setScalar(Math.max(2, s));
      });
    }
  });

  const flameSpots = [
    [0, 0],
    [14, 6],
    [-12, -5],
    [6, -14],
    [-8, 12],
  ];

  return (
    <group position={[at.x, 0, -at.y]}>
      <pointLight ref={light} position={[0, altitude + 40, 0]} color="#ff8a3d" intensity={12} distance={700} decay={0} />
      {/* Scorched ground */}
      <mesh position={[0, 0.32, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[75, 48]} />
        <meshBasicMaterial color="#1a1410" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      {['#fff4b8', '#ffb43a', '#ff5a1f'].map((color, i) => (
        <mesh key={color} ref={(m) => (fireballs.current[i] = m)} position={[0, altitude + 8, 0]} renderOrder={10 - i}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} blending={AdditiveBlending} />
        </mesh>
      ))}
      <mesh ref={ring} position={[0, altitude + 1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.92, 1, 64]} />
        <meshBasicMaterial color="#ffe2b0" transparent opacity={0.85} depthWrite={false} />
      </mesh>
      {debris.map((d, i) => (
        <mesh key={i} ref={(m) => (debrisRefs.current[i] = m)}>
          <boxGeometry args={[d.size * 2, d.size * 0.6, d.size]} />
          <meshStandardMaterial color={i % 3 === 0 ? '#d9dde3' : '#2b2622'} />
        </mesh>
      ))}
      <group ref={flames} position={[0, altitude + 4, 0]}>
        {flameSpots.map(([x, z], i) => (
          <mesh key={i} position={[x!, 0, z!]}>
            <sphereGeometry args={[1, 12, 8]} />
            <meshBasicMaterial color={i % 2 === 0 ? '#ffb13b' : '#ff6a1f'} transparent opacity={0.85} depthWrite={false} blending={AdditiveBlending} />
          </mesh>
        ))}
      </group>
      {puffs.map((_, i) => (
        <mesh key={i} ref={(m) => (puffRefs.current[i] = m)} visible={false}>
          <sphereGeometry args={[1, 14, 10]} />
          <meshBasicMaterial color={i % 3 === 0 ? '#8a837d' : '#5a544f'} transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
