import { useMemo } from 'react';
import { CatmullRomCurve3, RepeatWrapping, Vector3 } from 'three';
import { AIRPORT, LAYOUT_X, LAYOUT_Y } from '../sim/airport/layout';
import type { Vec2 } from '../sim/types';
import { toScene } from './coords';
import { Building, CarPark, dashes, Flat, Ribbon, RoundTrees, treeRow } from './sceneKit';
import { makeCanvasTexture, useDisposableTexture } from './textures';

/**
 * Suvarnabhumi-style terminal complex, designed to read from the top-down map camera: the vast
 * main terminal roof with its glazed bays, the concourse spine, the white membrane-roofed piers
 * (C and F crossing the spine, D in the middle), the satellite concourse, jet bridges at every
 * stand, and the landside forecourt, car parks and access roads to the north.
 */

const SPINE_SOUTH = LAYOUT_Y.spine;
const SPINE_NORTH = SPINE_SOUTH + 45;
const SPINE_HALF_LENGTH = 440;
const MAIN = { minX: -270, maxX: 270, minY: SPINE_NORTH, maxY: SPINE_NORTH + 180, height: 30 };
const PIER_HALF_WIDTH = 15;
const PIER_NORTH_END = 640;
const PIER_HEIGHT = 15;
const CENTER_PIER_TIP = 100;
const SATELLITE_HALF_LENGTH = 330;
/** Distance from a stand point to the building face it noses into. */
const STAND_TO_FACE = 45;

const COLORS = {
  glass: '#3f6f92',
  wall: '#c9ced5',
  bridge: '#b9c0c8',
  road: '#4a4e55',
  roadLine: '#eceae2',
  lawn: '#66904c',
};

// ---------------------------------------------------------------- textures

/** Main terminal roof: glazed bays between white mega-trusses. */
function makeMainRoofTexture() {
  const width = 1080;
  const height = 360;
  return makeCanvasTexture(width, height, (ctx) => {
    ctx.fillStyle = '#e6e9ed';
    ctx.fillRect(0, 0, width, height);
    const margin = 26;
    const cols = 6;
    const rows = 2;
    const gap = 16;
    const cw = (width - margin * 2 - gap * (cols - 1)) / cols;
    const rh = (height - margin * 2 - gap * (rows - 1)) / rows;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = margin + c * (cw + gap);
        const y = margin + r * (rh + gap);
        const glass = ctx.createLinearGradient(x, y, x + cw, y + rh);
        glass.addColorStop(0, '#93aabd');
        glass.addColorStop(1, '#6f8ca4');
        ctx.fillStyle = glass;
        ctx.fillRect(x, y, cw, rh);
        // Glass lamellae
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        for (let lx = x + 4; lx < x + cw; lx += 9) ctx.fillRect(lx, y, 2, rh);
        ctx.strokeStyle = 'rgba(40,60,80,0.45)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cw, rh);
      }
    }
    // Truss lattice in the white bands
    ctx.strokeStyle = 'rgba(120,132,146,0.5)';
    ctx.lineWidth = 1.5;
    for (let c = 1; c < cols; c++) {
      const x = margin + c * (cw + gap) - gap;
      for (let y = margin; y < height - margin; y += gap) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + gap, y + gap);
        ctx.moveTo(x + gap, y);
        ctx.lineTo(x, y + gap);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = '#a8b1bb';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, width - 8, height - 8);
  });
}

/**
 * Membrane concourse roof: one vaulted segment per repeat. Concourses running east-west
 * (`alongX`) get their ribs running north-south in the texture.
 */
function makeConcourseTexture(alongX: boolean, repeats: number) {
  const size = 64;
  const texture = makeCanvasTexture(size, size, (ctx) => {
    // Across the concourse: bright ridge, darker glazed edges.
    const shade = alongX ? ctx.createLinearGradient(0, 0, 0, size) : ctx.createLinearGradient(0, 0, size, 0);
    shade.addColorStop(0, '#9fb7ca');
    shade.addColorStop(0.1, '#dfe4e9');
    shade.addColorStop(0.5, '#fbfcfd');
    shade.addColorStop(0.9, '#dfe4e9');
    shade.addColorStop(1, '#9fb7ca');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, size, size);
    // Along the concourse: a rib per segment with a soft sag between ribs.
    const sag = alongX ? ctx.createLinearGradient(0, 0, size, 0) : ctx.createLinearGradient(0, 0, 0, size);
    sag.addColorStop(0, 'rgba(90,105,122,0.4)');
    sag.addColorStop(0.15, 'rgba(90,105,122,0)');
    sag.addColorStop(0.85, 'rgba(90,105,122,0)');
    sag.addColorStop(1, 'rgba(90,105,122,0.4)');
    ctx.fillStyle = sag;
    ctx.fillRect(0, 0, size, size);
  });
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(alongX ? repeats : 1, alongX ? 1 : repeats);
  return texture;
}

// ---------------------------------------------------------------- buildings

function ConcourseBox({ x, y, sx, sy, height = PIER_HEIGHT }: { x: number; y: number; sx: number; sy: number; height?: number }) {
  const alongX = sx > sy;
  const repeats = Math.max(1, Math.round(Math.max(sx, sy) / 15));
  const texture = useDisposableTexture(() => makeConcourseTexture(alongX, repeats), [alongX, repeats]);
  return <Building x={x} y={y} sx={sx} sy={sy} height={height} color={COLORS.wall} roof={texture} />;
}

function MainTerminal() {
  const roof = useDisposableTexture(makeMainRoofTexture, []);
  const cx = (MAIN.minX + MAIN.maxX) / 2;
  const cy = (MAIN.minY + MAIN.maxY) / 2;
  const sx = MAIN.maxX - MAIN.minX;
  const sy = MAIN.maxY - MAIN.minY;
  return (
    <group>
      {/* Glass hall under the roof */}
      <Building x={cx} y={cy - 6} sx={sx - 30} sy={sy - 24} height={MAIN.height - 3} color={COLORS.glass} />
      {/* The roof floats over the hall and the landside curb */}
      <mesh position={toScene({ x: cx, y: cy + 4 }, MAIN.height)} castShadow receiveShadow>
        <boxGeometry args={[sx + 20, 2.5, sy + 16]} />
        {[0, 1, 2, 3, 4, 5].map((face) =>
          face === 2 ? (
            <meshStandardMaterial key={face} attach={`material-${face}`} map={roof} roughness={0.5} metalness={0.15} />
          ) : (
            <meshStandardMaterial key={face} attach={`material-${face}`} color="#a8b1bb" />
          ),
        )}
      </mesh>
    </group>
  );
}

interface StandPose {
  position: Vec2;
  heading: number;
}

/** Every stand with a jet bridge: playable gates plus the contact stands among the scenery. */
function useStandPoses(): StandPose[] {
  return useMemo(() => {
    const nodes = new Map(AIRPORT.nodes.map((n) => [n.id, n]));
    const gates = AIRPORT.edges
      .filter((e) => e.kind === 'stand')
      .map((e) => {
        const apron = nodes.get(e.from)!.position;
        const gate = nodes.get(e.to)!.position;
        return { position: gate, heading: Math.atan2(gate.y - apron.y, gate.x - apron.x) };
      });
    // Remote stands (south of taxiway L) are bussed: no bridges.
    const scenery = AIRPORT.staticStands.filter((s) => s.position.y > LAYOUT_Y.taxiwayL);
    return [...gates, ...scenery];
  }, []);
}

/** Jet bridges reach from the building face back toward each parked aircraft's forward left door. */
function JetBridges() {
  const stands = useStandPoses();
  const length = 24;
  return (
    <group>
      {stands.map((s, i) => {
        const dir = { x: Math.cos(s.heading), y: Math.sin(s.heading) };
        const left = { x: -dir.y, y: dir.x };
        const at = (along: number) => ({ x: s.position.x + dir.x * along + left.x * 9, y: s.position.y + dir.y * along + left.y * 9 });
        return (
          <group key={i}>
            <mesh position={toScene(at(STAND_TO_FACE - length / 2), 7)} rotation={[0, s.heading, 0]} castShadow>
              <boxGeometry args={[length, 4.5, 4.5]} />
              <meshStandardMaterial color={COLORS.bridge} />
            </mesh>
            <mesh position={toScene(at(STAND_TO_FACE - length), 7)} rotation={[0, s.heading, 0]} castShadow>
              <boxGeometry args={[4, 5, 7]} />
              <meshStandardMaterial color="#8d959e" />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function Terminal() {
  const pierLength = PIER_NORTH_END - LAYOUT_Y.pierTip;
  const pierY = (PIER_NORTH_END + LAYOUT_Y.pierTip) / 2;
  return (
    <group>
      <MainTerminal />
      <ConcourseBox x={0} y={(SPINE_SOUTH + SPINE_NORTH) / 2} sx={SPINE_HALF_LENGTH * 2} sy={SPINE_NORTH - SPINE_SOUTH} height={18} />
      <ConcourseBox x={LAYOUT_X.pierC} y={pierY} sx={PIER_HALF_WIDTH * 2} sy={pierLength} />
      <ConcourseBox x={LAYOUT_X.pierF} y={pierY} sx={PIER_HALF_WIDTH * 2} sy={pierLength} />
      <ConcourseBox x={0} y={(SPINE_SOUTH + CENTER_PIER_TIP) / 2} sx={PIER_HALF_WIDTH * 2} sy={SPINE_SOUTH - CENTER_PIER_TIP} />
      <ConcourseBox x={0} y={LAYOUT_Y.satellite} sx={SATELLITE_HALF_LENGTH * 2} sy={PIER_HALF_WIDTH * 2} />
      {/* Pier tips and satellite ends are glazed rotundas */}
      {[
        { x: LAYOUT_X.pierC, y: LAYOUT_Y.pierTip },
        { x: LAYOUT_X.pierF, y: LAYOUT_Y.pierTip },
        { x: -SATELLITE_HALF_LENGTH, y: LAYOUT_Y.satellite },
        { x: SATELLITE_HALF_LENGTH, y: LAYOUT_Y.satellite },
      ].map((p, i) => (
        <mesh key={i} position={toScene(p, PIER_HEIGHT / 2 + 1)} castShadow>
          <cylinderGeometry args={[22, 22, PIER_HEIGHT + 2, 40]} />
          <meshStandardMaterial color="#9cc0da" metalness={0.4} roughness={0.2} />
        </mesh>
      ))}
      <JetBridges />
    </group>
  );
}

// ---------------------------------------------------------------- landside

const ROAD_WIDTH = 22;

/** Open loop: in from the north on the west leg, along the curb, out on the east leg. */
const CURB_ROAD: Vec2[] = (() => {
  const curbY = MAIN.maxY + 34;
  const controls: Vec2[] = [
    { x: -40, y: 1600 },
    { x: -40, y: 1120 },
    { x: -330, y: 960 },
    { x: -330, y: curbY + 60 },
    { x: -250, y: curbY },
    { x: 250, y: curbY },
    { x: 330, y: curbY + 60 },
    { x: 330, y: 960 },
    { x: 40, y: 1120 },
    { x: 40, y: 1600 },
  ];
  const curve = new CatmullRomCurve3(
    controls.map((p) => new Vector3(p.x, p.y, 0)),
    false,
    'centripetal',
  );
  return curve.getSpacedPoints(260).map((v) => ({ x: v.x, y: v.y }));
})();

const CAR_PARKS = [
  { x: -165, y: 775, sx: 210, sy: 150, seed: 7 },
  { x: 165, y: 775, sx: 210, sy: 150, seed: 11 },
];
const HOTEL = { x: 0, y: 975, sx: 120, sy: 42, height: 48 };

function makeHotelRoofTexture() {
  return makeCanvasTexture(480, 168, (ctx) => {
    ctx.fillStyle = '#8f949a';
    ctx.fillRect(0, 0, 480, 168);
    ctx.fillStyle = '#c4c8cc';
    ctx.fillRect(24, 34, 140, 100);
    ctx.fillStyle = '#3a3f45';
    ctx.beginPath();
    ctx.arc(360, 84, 64, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f2c230';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 82px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', 360, 88);
  });
}

function Hotel() {
  const roof = useDisposableTexture(makeHotelRoofTexture, []);
  return <Building {...HOTEL} color="#d8d1c4" roof={roof} />;
}

export function Landside() {
  const road = useMemo(() => [CURB_ROAD], []);
  const centerDashes = useMemo(() => dashes(CURB_ROAD, 9, 9), []);
  const canopy = useMemo(
    () => [
      [
        { x: -260, y: MAIN.maxY + 14 },
        { x: 260, y: MAIN.maxY + 14 },
      ],
    ],
    [],
  );
  const trees = useMemo(() => {
    const t: Vec2[] = [];
    for (const side of [-1, 1]) {
      t.push(...treeRow({ x: side * 70, y: 690 }, { x: side * 260, y: 690 }, 24));
      t.push(...treeRow({ x: side * 385, y: 720 }, { x: side * 385, y: 1150 }, 28));
      t.push(...treeRow({ x: side * 95, y: 1190 }, { x: side * 95, y: 1550 }, 26));
    }
    t.push(...treeRow({ x: 0, y: 1180 }, { x: 0, y: 1550 }, 30));
    return t;
  }, []);

  return (
    <group>
      <Ribbon lines={road} width={ROAD_WIDTH} color={COLORS.road} height={0.14} />
      <Ribbon lines={centerDashes} width={0.7} color={COLORS.roadLine} height={0.2} />
      <Ribbon lines={canopy} width={16} color="#f4f6f8" height={10} castShadow />
      <Flat x={0} y={880} sx={150} sy={70} color={COLORS.lawn} height={0.1} />
      <mesh position={toScene({ x: 0, y: 880 }, 0.2)} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[24, 48]} />
        <meshStandardMaterial color="#3d87bd" metalness={0.3} roughness={0.08} />
      </mesh>
      {CAR_PARKS.map((c) => (
        <CarPark key={c.seed} {...c} />
      ))}
      <Hotel />
      <RoundTrees positions={trees} seed={5} />
    </group>
  );
}
