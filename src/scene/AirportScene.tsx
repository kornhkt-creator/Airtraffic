import { useLayoutEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { DoubleSide, Object3D, type InstancedMesh } from 'three';
import { AIRPORT, LAYOUT_X, LAYOUT_Y, type RunwayDef } from '../sim/airport/layout';
import { Rng } from '../sim/rng';
import type { Vec2 } from '../sim/types';
import { toScene } from './coords';
import { makeTextTexture, useDisposableTexture } from './textures';
import { Landside, Terminal } from './Terminal';
import { StaticAircraft } from './AircraftModel';

// Surface heights (Three.js Y). Higher layers are drawn over lower ones.
const H = {
  apron: 0.08,
  taxiway: 0.14,
  taxiLine: 0.18,
  runway: 0.24,
  marking: 0.27,
};

/** Paved widths sized for the game's enlarged aircraft. */
const TAXIWAY_WIDTH = 32;

/** Paved apron around the piers and satellite (sim extents). */
const APRON = { minX: -565, maxX: 565, minY: -800, maxY: 345 };

const COLORS = {
  grass: '#5d7f45',
  grassDark: '#4f6e3a',
  asphalt: '#3b3f45',
  runway: '#2f3237',
  concrete: '#8d9196',
  white: '#f2f2ee',
  yellow: '#f2c230',
  terminal: '#c9ced6',
  glass: '#5f8fb3',
  roof: '#6c737d',
};

interface Rect {
  /** Center and size in the parent's sim-aligned frame. */
  x: number;
  y: number;
  sx: number;
  sy: number;
}

/** Flat rectangles lying on the ground at a given height. */
function FlatRects({ rects, color, height }: { rects: Rect[]; color: string; height: number }) {
  return (
    <group>
      {rects.map((r, i) => (
        <mesh key={i} position={[r.x, height, -r.y]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[r.sx, r.sy]} />
          <meshStandardMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

/** A flat strip between two sim points. */
function Strip({ a, b, width, color, height }: { a: Vec2; b: Vec2; width: number; color: string; height: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  return (
    <mesh position={[(a.x + b.x) / 2, height, -(a.y + b.y) / 2]} rotation={[-Math.PI / 2, 0, angle]} receiveShadow>
      <planeGeometry args={[length, width]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

/** Text painted on the ground. `upAngle` is the sim heading the top of the text points to. */
function GroundText({ text, x, y, upAngle, width, length, color = COLORS.white, height = H.marking + 0.01 }: { text: string; x: number; y: number; upAngle: number; width: number; length: number; color?: string; height?: number }) {
  const texture = useDisposableTexture(
    () => makeTextTexture(text, { width: 128 * Math.max(2, text.length), height: 384, color, font: 'bold 300px "Segoe UI", Arial, sans-serif' }),
    [text, color],
  );
  return (
    <group position={[x, height, -y]} rotation={[0, upAngle - Math.PI / 2, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial map={texture} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

/** A runway in its own frame: local +x runs from the threshold in use toward the far end. */
function Runway({ runway }: { runway: RunwayDef }) {
  const half = runway.length / 2;
  const w = runway.width;
  const center = { x: (runway.start.x + runway.end.x) / 2, y: (runway.start.y + runway.end.y) / 2 };

  const markings = useMemo(() => {
    const rects: Rect[] = [];
    // Edge lines
    rects.push({ x: 0, y: w / 2 - 1, sx: runway.length, sy: 0.9 }, { x: 0, y: -w / 2 + 1, sx: runway.length, sy: 0.9 });
    // Centerline dashes
    for (let x = -half + 120; x <= half - 120; x += 50) rects.push({ x, y: 0, sx: 30, sy: 0.9 });
    for (const dir of [1, -1]) {
      const threshold = -half * dir;
      // Threshold "piano keys"
      for (const off of [3.5, 7, 10.5, 14, 17.5, 21, 24.5]) {
        for (const side of [1, -1]) rects.push({ x: threshold + dir * 21, y: side * off, sx: 30, sy: 1.8 });
      }
      // Aiming point markers
      for (const side of [1, -1]) rects.push({ x: threshold + dir * 250, y: side * 9, sx: 45, sy: 6 });
      // Touchdown zone bars
      for (const dist of [130, 380, 500]) {
        for (const side of [1, -1]) {
          for (const off of [4, 7]) rects.push({ x: threshold + dir * (dist + 11), y: side * (off + 6), sx: 22.5, sy: 1.8 });
        }
      }
    }
    return rects;
  }, [half, runway.length, w]);

  return (
    <group position={toScene(center)} rotation={[0, runway.heading, 0]}>
      <mesh position={[0, H.runway / 2, 0]} receiveShadow>
        <boxGeometry args={[runway.length + 60, H.runway, w + 6]} />
        <meshStandardMaterial color={COLORS.runway} />
      </mesh>
      <FlatRects rects={markings} color={COLORS.white} height={H.marking} />
      {/* Designators painted large, just past the threshold piano keys. */}
      <GroundText text={runway.designators[0]} x={-half + 100} y={0} upAngle={0} width={46} length={80} />
      <GroundText text={runway.designators[1]} x={half - 100} y={0} upAngle={Math.PI} width={46} length={80} />
    </group>
  );
}

/** Screen-space runway sign below the threshold in use, readable at any zoom. */
function RunwaySign({ runway, use }: { runway: RunwayDef; use: string }) {
  const dir = { x: Math.cos(runway.heading), y: Math.sin(runway.heading) };
  const at = { x: runway.start.x - dir.x * 110, y: runway.start.y - dir.y * 110 };
  return (
    <Html position={toScene(at, 2)} center zIndexRange={[10, 0]}>
      <div className="rwy-sign">
        <span className="rwy-sign-id">{runway.designators[0]}</span>
        <span className="rwy-sign-use">{use}</span>
      </div>
    </Html>
  );
}

function Taxiways() {
  const nodes = useMemo(() => new Map(AIRPORT.nodes.map((n) => [n.id, n])), []);
  const groundEdges = AIRPORT.edges.filter((e) => e.kind !== 'runway');
  const jointNodes = AIRPORT.nodes.filter((n) => n.kind !== 'runway' && n.kind !== 'gate' && n.kind !== 'apron');

  return (
    <group>
      {groundEdges.map((e) => {
        const a = nodes.get(e.from)?.position;
        const b = nodes.get(e.to)?.position;
        if (!a || !b) return null;
        return (
          <group key={`${e.from}-${e.to}`}>
            {e.kind !== 'apron' && e.kind !== 'stand' && <Strip a={a} b={b} width={TAXIWAY_WIDTH} color={COLORS.asphalt} height={H.taxiway} />}
            <Strip a={a} b={b} width={0.8} color={COLORS.yellow} height={H.taxiLine} />
          </group>
        );
      })}
      {jointNodes.map((n) => (
        <mesh key={n.id} position={toScene(n.position, H.taxiway - 0.005)} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[TAXIWAY_WIDTH * 0.8, 32]} />
          <meshStandardMaterial color={COLORS.asphalt} />
        </mesh>
      ))}
    </group>
  );
}

/** Hold-short lines across every runway connector: solid on the runway side, dashed on the taxiway side. */
function HoldShortMarkings() {
  const nodes = useMemo(() => new Map(AIRPORT.nodes.map((n) => [n.id, n])), []);
  const connectors = AIRPORT.edges.filter((e) => e.kind === 'runwayConnector');
  const local = useMemo(() => {
    const rects: Rect[] = [{ x: -1.5, y: 0, sx: 0.5, sy: TAXIWAY_WIDTH }, { x: -0.6, y: 0, sx: 0.5, sy: TAXIWAY_WIDTH }];
    for (let k = -3; k <= 3; k++) rects.push({ x: 0.6, y: k * 4.5, sx: 0.5, sy: 2.5 }, { x: 1.5, y: k * 4.5, sx: 0.5, sy: 2.5 });
    return rects;
  }, []);
  return (
    <group>
      {connectors.map((c) => {
        const rwy = nodes.get(c.from)!.position;
        const other = nodes.get(c.to)!.position;
        const angle = Math.atan2(other.y - rwy.y, other.x - rwy.x);
        const p = { x: rwy.x + Math.cos(angle) * AIRPORT.holdShortOffset, y: rwy.y + Math.sin(angle) * AIRPORT.holdShortOffset };
        return (
          <group key={c.name} position={toScene(p)} rotation={[0, angle, 0]}>
            <FlatRects rects={local} color={COLORS.yellow} height={H.taxiLine + 0.01} />
          </group>
        );
      })}
    </group>
  );
}

/** Concrete aprons, stop bars and stand numbers for the playable gates. */
function ApronAndStands() {
  const nodes = useMemo(() => new Map(AIRPORT.nodes.map((n) => [n.id, n])), []);
  const stands = AIRPORT.edges
    .filter((e) => e.kind === 'stand')
    .map((e) => {
      const apron = nodes.get(e.from)!;
      const gate = nodes.get(e.to)!;
      const dir = Math.sign(gate.position.x - apron.position.x);
      return { gate, apron, dir };
    });
  const northArms: Rect[] = [LAYOUT_X.pierC, LAYOUT_X.pierF].map((x) => ({ x: x + Math.sign(x) * 100, y: 500, sx: 200, sy: 310 }));
  return (
    <group>
      <FlatRects
        rects={[{ x: (APRON.minX + APRON.maxX) / 2, y: (APRON.minY + APRON.maxY) / 2, sx: APRON.maxX - APRON.minX, sy: APRON.maxY - APRON.minY }, ...northArms]}
        color={COLORS.concrete}
        height={H.apron}
      />
      {/* Stop bars sit under the parked nose (half a fuselage toward the pier from the stand point). */}
      <FlatRects rects={stands.map(({ gate, dir }) => ({ x: gate.position.x + dir * 34, y: gate.position.y, sx: 0.8, sy: 14 }))} color={COLORS.yellow} height={H.taxiLine} />
      {stands.map(({ gate, apron }) => (
        <GroundText
          key={gate.id}
          text={(gate.label ?? gate.id).replace('Gate ', '')}
          x={gate.position.x + Math.sign(apron.position.x - gate.position.x) * 58}
          y={gate.position.y}
          upAngle={Math.PI / 2}
          width={22}
          length={14}
          color={COLORS.yellow}
          height={H.taxiLine + 0.02}
        />
      ))}
    </group>
  );
}

function ControlTower({ at }: { at: Vec2 }) {
  return (
    <group position={toScene(at)}>
      <mesh position={[0, 5, 0]} castShadow receiveShadow>
        <boxGeometry args={[24, 10, 24]} />
        <meshStandardMaterial color={COLORS.terminal} />
      </mesh>
      <mesh position={[0, 40, 0]} castShadow>
        <cylinderGeometry args={[4.5, 6, 60, 16]} />
        <meshStandardMaterial color="#d9dde3" />
      </mesh>
      <mesh position={[0, 74, 0]} castShadow>
        <cylinderGeometry args={[12, 9, 9, 8]} />
        <meshStandardMaterial color={COLORS.glass} metalness={0.5} roughness={0.15} />
      </mesh>
      <mesh position={[0, 79.5, 0]} castShadow>
        <cylinderGeometry args={[13, 13, 2, 8]} />
        <meshStandardMaterial color={COLORS.roof} />
      </mesh>
    </group>
  );
}

function Hangar({ at }: { at: Vec2 }) {
  return (
    <group position={toScene(at)}>
      <mesh position={[0, 12, 0]} castShadow receiveShadow>
        <boxGeometry args={[130, 24, 70]} />
        <meshStandardMaterial color="#b9bec4" />
      </mesh>
      <mesh position={[0, 24, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.9]} castShadow>
        <cylinderGeometry args={[35, 35, 130, 24, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#8e959d" side={DoubleSide} />
      </mesh>
    </group>
  );
}

function Trees() {
  const ref = useRef<InstancedMesh>(null);
  const count = 420;
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rng = new Rng(2024);
    const dummy = new Object3D();
    let placed = 0;
    while (placed < count) {
      const x = rng.range(-5000, 4000);
      const y = rng.range(-3000, 2600);
      const inAirport = x > -1150 && x < 1150 && y > -1100 && y < 1700;
      if (inAirport) continue;
      const s = rng.range(0.7, 1.5);
      dummy.position.set(x, 6 * s, -y);
      dummy.scale.set(s, s, s);
      dummy.rotation.y = rng.range(0, Math.PI);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow>
      <coneGeometry args={[5, 14, 7]} />
      <meshStandardMaterial color="#35562b" />
    </instancedMesh>
  );
}

export function AirportScene() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60000, 60000]} />
        <meshStandardMaterial color={COLORS.grass} />
      </mesh>
      {/* Airport property */}
      <mesh position={toScene({ x: 0, y: 300 }, 0.03)} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2300, 2800]} />
        <meshStandardMaterial color={COLORS.grassDark} />
      </mesh>
      <Runway runway={AIRPORT.arrivalRunway} />
      <Runway runway={AIRPORT.departureRunway} />
      <RunwaySign runway={AIRPORT.arrivalRunway} use="ARR" />
      <RunwaySign runway={AIRPORT.departureRunway} use="DEP / ARR" />
      <Taxiways />
      <HoldShortMarkings />
      <ApronAndStands />
      <Terminal />
      <Landside />
      <StaticAircraft stands={AIRPORT.staticStands} />
      <ControlTower at={{ x: -540, y: 560 }} />
      <Hangar at={{ x: -330, y: LAYOUT_Y.runwaySouth + 20 }} />
      <Hangar at={{ x: 330, y: LAYOUT_Y.runwaySouth + 20 }} />
      <Trees />
    </group>
  );
}
