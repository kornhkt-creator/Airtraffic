import { useLayoutEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Object3D, type InstancedMesh } from 'three';
import { Rng } from '../sim/rng';
import type { Vec2 } from '../sim/types';
import { toScene } from './coords';
import { makeCanvasTexture, useDisposableTexture } from './textures';

/** Small building blocks shared by the procedural airport scenery. */

/** Offsets an open polyline sideways (positive = to the left of travel). */
export function offsetLine(line: Vec2[], distance: number): Vec2[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)]!;
    const b = line[Math.min(line.length - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: p.x - ((b.y - a.y) / len) * distance, y: p.y + ((b.x - a.x) / len) * distance };
  });
}

/** One merged flat mesh of strips following polylines. */
export function ribbonGeometry(lines: Vec2[][], width: number, closed = false): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const line of lines) {
    const n = line.length;
    const base = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const prev = closed ? line[(i - 1 + n) % n]! : line[Math.max(0, i - 1)]!;
      const next = closed ? line[(i + 1) % n]! : line[Math.min(n - 1, i + 1)]!;
      const p = line[i]!;
      const len = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
      const nx = (-(next.y - prev.y) / len) * (width / 2);
      const ny = ((next.x - prev.x) / len) * (width / 2);
      positions.push(p.x + nx, 0, -(p.y + ny), p.x - nx, 0, -(p.y - ny));
    }
    const segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
      const a = base + 2 * i;
      const c = base + 2 * ((i + 1) % n);
      indices.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(positions.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Cuts a polyline into dashes. */
export function dashes(line: Vec2[], dash: number, gap: number): Vec2[][] {
  const out: Vec2[][] = [];
  let current: Vec2[] = [];
  let phase = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let t = 0;
    while (t < len) {
      const inDash = phase < dash;
      const step = Math.min(len - t, inDash ? dash - phase : dash + gap - phase);
      const p = { x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len };
      const q = { x: a.x + ((b.x - a.x) * (t + step)) / len, y: a.y + ((b.y - a.y) * (t + step)) / len };
      if (inDash) {
        if (current.length === 0) current.push(p);
        current.push(q);
      } else if (current.length) {
        out.push(current);
        current = [];
      }
      t += step;
      phase = (phase + step) % (dash + gap);
    }
  }
  if (current.length > 1) out.push(current);
  return out;
}

export function Ribbon({ lines, width, color, height, castShadow = false }: { lines: Vec2[][]; width: number; color: string; height: number; castShadow?: boolean }) {
  const geometry = useMemo(() => ribbonGeometry(lines, width), [lines, width]);
  return (
    <mesh geometry={geometry} position={[0, height, 0]} receiveShadow castShadow={castShadow}>
      <meshStandardMaterial color={color} side={DoubleSide} />
    </mesh>
  );
}

/** Axis-aligned flat rectangle on the ground (sim center and size). */
export function Flat({ x, y, sx, sy, color, height }: { x: number; y: number; sx: number; sy: number; color: string; height: number }) {
  return (
    <mesh position={toScene({ x, y }, height)} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[sx, sy]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

/** Box standing on the ground with an optional textured roof (north at the top of the texture). */
export function Building({ x, y, sx, sy, height, color, roof, roofColor }: { x: number; y: number; sx: number; sy: number; height: number; color: string; roof?: ReturnType<typeof makeCanvasTexture>; roofColor?: string }) {
  return (
    <mesh position={toScene({ x, y }, height / 2)} castShadow receiveShadow>
      <boxGeometry args={[sx, height, sy]} />
      {[0, 1, 2, 3, 4, 5].map((face) =>
        face === 2 ? (
          <meshStandardMaterial key={face} attach={`material-${face}`} map={roof ?? null} color={roof ? '#ffffff' : (roofColor ?? color)} />
        ) : (
          <meshStandardMaterial key={face} attach={`material-${face}`} color={color} />
        ),
      )}
    </mesh>
  );
}

export function treeRow(a: Vec2, b: Vec2, spacing: number): Vec2[] {
  const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / spacing));
  return Array.from({ length: n + 1 }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }));
}

/** Rounded deciduous trees for the landscaping (instanced, varied greens). */
export function RoundTrees({ positions, seed }: { positions: Vec2[]; seed: number }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rng = new Rng(seed);
    const dummy = new Object3D();
    const color = new Color();
    positions.forEach((p, i) => {
      const s = rng.range(0.85, 1.25);
      dummy.position.set(p.x, 5 * s, -p.y);
      dummy.scale.set(s, s * 0.8, s);
      dummy.rotation.y = rng.range(0, Math.PI);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHSL(rng.range(0.25, 0.33), rng.range(0.35, 0.55), rng.range(0.22, 0.32)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [positions, seed]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, positions.length]} castShadow receiveShadow>
      <icosahedronGeometry args={[6.5, 1]} />
      <meshStandardMaterial flatShading />
    </instancedMesh>
  );
}

const CAR_COLORS = ['#e8e8e8', '#1f2328', '#9aa0a6', '#b3261e', '#1e5aa8', '#f2f2f2', '#5f6368', '#2e7d32', '#c9a227'];

/** Car park top deck (meters → 2 px): bays, aisles and parked cars. */
function makeParkingTexture(sx: number, sy: number, seed: number) {
  const ppm = 2;
  const width = Math.round(sx * ppm);
  const height = Math.round(sy * ppm);
  return makeCanvasTexture(width, height, (ctx) => {
    const rng = new Rng(seed);
    ctx.fillStyle = '#5b6067';
    ctx.fillRect(0, 0, width, height);
    const bay = { w: 6 * ppm, d: 11 * ppm };
    const aisle = 14 * ppm;
    for (let y = 8 * ppm; y + bay.d * 2 < height - 6 * ppm; y += bay.d * 2 + aisle) {
      for (let x = 8 * ppm; x + bay.w < width - 8 * ppm; x += bay.w) {
        for (const row of [0, 1]) {
          const top = y + row * bay.d;
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, top, bay.w, bay.d);
          if (rng.next() < 0.78) {
            ctx.fillStyle = CAR_COLORS[Math.floor(rng.next() * CAR_COLORS.length)]!;
            ctx.fillRect(x + 2, top + 3, bay.w - 4, bay.d - 6);
            ctx.fillStyle = 'rgba(20,30,45,0.55)';
            ctx.fillRect(x + 3, top + (row === 0 ? bay.d - 9 : 5), bay.w - 6, 4);
          }
        }
      }
    }
    ctx.strokeStyle = '#f2c230';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, width - 3, height - 3);
  });
}

export function CarPark({ x, y, sx, sy, seed }: { x: number; y: number; sx: number; sy: number; seed: number }) {
  const texture = useDisposableTexture(() => makeParkingTexture(sx, sy, seed), [sx, sy, seed]);
  return <Building x={x} y={y} sx={sx} sy={sy} height={12} color="#b7bcc2" roof={texture} />;
}
