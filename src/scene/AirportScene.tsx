import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { DoubleSide, Object3D, type InstancedMesh, type Texture } from 'three';
import { AIRPORT } from '../sim/airport/layout';
import { Rng } from '../sim/rng';
import { toScene } from './coords';
import { makeTextTexture } from './textures';

// Surface heights (Three.js Y). Higher layers are drawn over lower ones.
const H = {
  apron: 0.08,
  taxiway: 0.14,
  taxiLine: 0.18,
  runway: 0.24,
  marking: 0.27,
};

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
  /** Sim coordinates of the rectangle center. */
  x: number;
  y: number;
  /** Size along sim x and sim y. */
  sx: number;
  sy: number;
}

/** Flat rectangles lying on the ground at a given height (sim-axis aligned). */
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
function Strip({ a, b, width, color, height }: { a: { x: number; y: number }; b: { x: number; y: number }; width: number; color: string; height: number }) {
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

function useTexture(factory: () => Texture, deps: unknown[]): Texture {
  const texture = useMemo(factory, deps);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/** Text painted on the ground. `upAngle` is the sim heading the top of the text points to. */
function GroundText({ text, x, y, upAngle, width, length, color = COLORS.white }: { text: string; x: number; y: number; upAngle: number; width: number; length: number; color?: string }) {
  const texture = useTexture(() => makeTextTexture(text, { width: 256, height: 384, color, font: 'bold 300px "Segoe UI", Arial, sans-serif' }), [text, color]);
  return (
    <group position={[x, H.marking + 0.01, -y]} rotation={[0, upAngle - Math.PI / 2, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial map={texture} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

type SignKind = 'mandatory' | 'location' | 'direction';

const SIGN_STYLE: Record<SignKind, { color: string; background: string; border?: string }> = {
  mandatory: { color: '#ffffff', background: '#c62828', border: '#ffffff' },
  location: { color: COLORS.yellow, background: '#111111', border: COLORS.yellow },
  direction: { color: '#111111', background: COLORS.yellow },
};

function SignPanel({ text, kind, offset }: { text: string; kind: SignKind; offset: number }) {
  const texture = useTexture(() => makeTextTexture(text, { width: 256, height: 128, ...SIGN_STYLE[kind] }), [text, kind]);
  return (
    <mesh position={[offset, 0, 0.26]}>
      <planeGeometry args={[4, 2]} />
      <meshStandardMaterial map={texture} />
    </mesh>
  );
}

/** Taxiway sign board. Faces the sim heading `facing` (aircraft approaching from that side read it). */
function Sign({ x, y, facing, panels }: { x: number; y: number; facing: number; panels: { text: string; kind: SignKind }[] }) {
  const width = panels.length * 4;
  return (
    <group position={[x, 1.6, -y]} rotation={[0, facing + Math.PI / 2, 0]}>
      <mesh castShadow>
        <boxGeometry args={[width + 0.4, 2.4, 0.5]} />
        <meshStandardMaterial color="#222222" />
      </mesh>
      {panels.map((p, i) => (
        <SignPanel key={i} text={p.text} kind={p.kind} offset={(i - (panels.length - 1) / 2) * 4} />
      ))}
      <mesh position={[0, -1.2, 0]}>
        <boxGeometry args={[0.3, 1, 0.3]} />
        <meshStandardMaterial color="#555555" />
      </mesh>
    </group>
  );
}

function Runway() {
  const { runway } = AIRPORT;
  const half = runway.length / 2;
  const w = runway.width;

  const markings = useMemo(() => {
    const rects: Rect[] = [];
    // Edge lines
    rects.push({ x: 0, y: w / 2 - 1, sx: runway.length, sy: 0.9 }, { x: 0, y: -w / 2 + 1, sx: runway.length, sy: 0.9 });
    // Centerline dashes
    for (let x = -half + 120; x <= half - 120; x += 50) rects.push({ x, y: 0, sx: 30, sy: 0.9 });
    for (const dir of [1, -1]) {
      const threshold = -half * dir;
      // Threshold "piano keys"
      for (const off of [3.5, 7, 10.5, 14, 17.5]) {
        for (const side of [1, -1]) rects.push({ x: threshold + dir * 21, y: side * off, sx: 30, sy: 1.8 });
      }
      // Aiming point markers (300 m)
      for (const side of [1, -1]) rects.push({ x: threshold + dir * 322, y: side * 7, sx: 45, sy: 6 });
      // Touchdown zone bars
      for (const dist of [150, 450, 600]) {
        for (const side of [1, -1]) {
          for (const off of [4, 7]) rects.push({ x: threshold + dir * (dist + 11), y: side * (off + 4), sx: 22.5, sy: 1.8 });
        }
      }
    }
    return rects;
  }, [half, runway.length, w]);

  return (
    <group>
      <mesh position={[0, H.runway / 2, 0]} receiveShadow>
        <boxGeometry args={[runway.length + 60, H.runway, w + 6]} />
        <meshStandardMaterial color={COLORS.runway} />
      </mesh>
      <FlatRects rects={markings} color={COLORS.white} height={H.marking} />
      <GroundText text={runway.designators[0]} x={-half + 70} y={0} upAngle={0} width={16} length={26} />
      <GroundText text={runway.designators[1]} x={half - 70} y={0} upAngle={Math.PI} width={16} length={26} />
    </group>
  );
}

function Taxiways() {
  const nodes = useMemo(() => new Map(AIRPORT.nodes.map((n) => [n.id, n])), []);
  const groundEdges = AIRPORT.edges.filter((e) => e.kind !== 'runway');
  const jointNodes = AIRPORT.nodes.filter((n) => n.kind !== 'runway' && n.kind !== 'gate');

  return (
    <group>
      {groundEdges.map((e) => {
        const a = nodes.get(e.from)?.position;
        const b = nodes.get(e.to)?.position;
        if (!a || !b) return null;
        const width = e.kind === 'stand' ? 18 : 23;
        return (
          <group key={`${e.from}-${e.to}`}>
            {e.kind !== 'apron' && e.kind !== 'stand' && <Strip a={a} b={b} width={width} color={COLORS.asphalt} height={H.taxiway} />}
            <Strip a={a} b={b} width={0.6} color={COLORS.yellow} height={H.taxiLine} />
          </group>
        );
      })}
      {jointNodes.map((n) => (
        <mesh key={n.id} position={toScene(n.position, H.taxiway - 0.005)} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[n.kind === 'apron' ? 12 : 20, 32]} />
          <meshStandardMaterial color={n.kind === 'apron' ? COLORS.concrete : COLORS.asphalt} />
        </mesh>
      ))}
    </group>
  );
}

function HoldShortMarkings() {
  const y = -AIRPORT.holdShortOffset;
  const connectors = AIRPORT.edges.filter((e) => e.kind === 'runwayConnector');
  const rects: Rect[] = [];
  for (const c of connectors) {
    const rwyNode = AIRPORT.nodes.find((n) => n.id === c.from);
    if (!rwyNode) continue;
    const x = rwyNode.position.x;
    // Two solid lines (runway side) and two dashed lines (taxiway side)
    rects.push({ x, y: y + 1.5, sx: 23, sy: 0.4 }, { x, y: y + 0.6, sx: 23, sy: 0.4 });
    for (let k = -2; k <= 2; k++) rects.push({ x: x + k * 4.5, y: y - 0.6, sx: 2.5, sy: 0.4 }, { x: x + k * 4.5, y: y - 1.5, sx: 2.5, sy: 0.4 });
  }
  return <FlatRects rects={rects} color={COLORS.yellow} height={H.taxiLine + 0.01} />;
}

function ApronAndStands() {
  const gates = AIRPORT.nodes.filter((n) => n.kind === 'gate');
  return (
    <group>
      <FlatRects rects={[{ x: 0, y: -318, sx: 860, sy: 180 }]} color={COLORS.concrete} height={H.apron} />
      <FlatRects rects={gates.map((g) => ({ x: g.position.x, y: g.position.y - 6, sx: 10, sy: 0.6 }))} color={COLORS.yellow} height={H.taxiLine} />
      {gates.map((g, i) => (
        <GroundText key={g.id} text={String(i + 1)} x={g.position.x + 14} y={g.position.y + 20} upAngle={Math.PI / 2} width={8} length={12} color={COLORS.yellow} />
      ))}
    </group>
  );
}

function Terminal() {
  const gates = AIRPORT.nodes.filter((n) => n.kind === 'gate');
  return (
    <group>
      {/* Main hall */}
      <mesh position={toScene({ x: 0, y: -445 }, 9)} castShadow receiveShadow>
        <boxGeometry args={[840, 18, 60]} />
        <meshStandardMaterial color={COLORS.terminal} />
      </mesh>
      <mesh position={toScene({ x: 0, y: -414.8 }, 10)}>
        <planeGeometry args={[820, 8]} />
        <meshStandardMaterial color={COLORS.glass} metalness={0.4} roughness={0.2} />
      </mesh>
      <mesh position={toScene({ x: 0, y: -445 }, 19)} castShadow>
        <boxGeometry args={[850, 2, 66]} />
        <meshStandardMaterial color={COLORS.roof} />
      </mesh>
      {/* Jet bridges */}
      {gates.map((g) => (
        <group key={g.id}>
          <mesh position={toScene({ x: g.position.x + 16, y: -397 }, 5)} castShadow>
            <boxGeometry args={[4, 4, 32]} />
            <meshStandardMaterial color="#9aa1aa" />
          </mesh>
          <mesh position={toScene({ x: g.position.x + 16, y: -382 }, 1.5)}>
            <boxGeometry args={[1, 3, 1]} />
            <meshStandardMaterial color="#555" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function ControlTower() {
  const p = { x: 560, y: -440 };
  return (
    <group position={toScene(p)}>
      <mesh position={[0, 5, 0]} castShadow receiveShadow>
        <boxGeometry args={[16, 10, 16]} />
        <meshStandardMaterial color={COLORS.terminal} />
      </mesh>
      <mesh position={[0, 30, 0]} castShadow>
        <cylinderGeometry args={[3.5, 4.5, 42, 16]} />
        <meshStandardMaterial color="#d9dde3" />
      </mesh>
      <mesh position={[0, 53, 0]} castShadow>
        <cylinderGeometry args={[9, 7, 7, 8]} />
        <meshStandardMaterial color={COLORS.glass} metalness={0.5} roughness={0.15} />
      </mesh>
      <mesh position={[0, 57.5, 0]} castShadow>
        <cylinderGeometry args={[10, 10, 1.5, 8]} />
        <meshStandardMaterial color={COLORS.roof} />
      </mesh>
      <mesh position={[0, 61, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 6, 6]} />
        <meshStandardMaterial color="#444" />
      </mesh>
    </group>
  );
}

function Hangar() {
  return (
    <group position={toScene({ x: -760, y: -400 })}>
      <mesh position={[0, 12, 0]} castShadow receiveShadow>
        <boxGeometry args={[120, 24, 80]} />
        <meshStandardMaterial color="#b9bec4" />
      </mesh>
      <mesh position={[0, 24, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[40, 40, 120, 24, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#8e959d" side={DoubleSide} />
      </mesh>
      <mesh position={[0, 10, 40.1]}>
        <planeGeometry args={[100, 20]} />
        <meshStandardMaterial color="#6b7178" />
      </mesh>
    </group>
  );
}

function Trees() {
  const ref = useRef<InstancedMesh>(null);
  const count = 260;
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rng = new Rng(2024);
    const dummy = new Object3D();
    let placed = 0;
    while (placed < count) {
      const x = rng.range(-3500, 3500);
      const y = rng.range(-2200, 1500);
      const inAirport = x > -1250 && x < 1250 && y > -620 && y < 160;
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

function Signs() {
  const exits = AIRPORT.edges.filter((e) => e.kind === 'runwayConnector');
  return (
    <group>
      {exits.map((e) => {
        const n = AIRPORT.nodes.find((k) => k.id === e.from);
        if (!n) return null;
        return (
          <Sign
            key={e.name}
            x={n.position.x - 22}
            y={-AIRPORT.holdShortOffset - 4}
            facing={-Math.PI / 2}
            panels={[
              { text: e.name, kind: 'location' },
              { text: '09-27', kind: 'mandatory' },
            ]}
          />
        );
      })}
      <Sign x={-230} y={-160} facing={0} panels={[{ text: 'A', kind: 'location' }, { text: '← B', kind: 'direction' }]} />
      <Sign x={230} y={-160} facing={Math.PI} panels={[{ text: 'A', kind: 'location' }, { text: 'C →', kind: 'direction' }]} />
    </group>
  );
}

export function AirportScene() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[60000, 60000]} />
        <meshStandardMaterial color={COLORS.grass} />
      </mesh>
      <mesh position={[0, 0.03, 120]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2600, 900]} />
        <meshStandardMaterial color={COLORS.grassDark} />
      </mesh>
      <Runway />
      <Taxiways />
      <HoldShortMarkings />
      <ApronAndStands />
      <Terminal />
      <ControlTower />
      <Hangar />
      <Signs />
      <Trees />
    </group>
  );
}
