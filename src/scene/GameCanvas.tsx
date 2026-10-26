import { Canvas, useFrame } from '@react-three/fiber';
import { useGame } from '../game/GameContext';
import { AirportScene } from './AirportScene';
import { AircraftLayer } from './AircraftLayer';
import { ApproachGuides, SelectedRoute } from './RouteOverlay';
import { CameraRig } from './CameraRig';
import { CrashEffects } from './Explosion';
import { CAMERA_HEIGHT } from './cameraPresets';

const SKY = '#a8c8e6';

/** Drives the simulation from the render loop. Mounted first so it runs before the models read state. */
function GameLoop() {
  const controller = useGame();
  useFrame((_, delta) => controller.frame(delta));
  return null;
}

function Lighting() {
  return (
    <>
      <hemisphereLight args={['#dbe9ff', '#4a5a3a', 0.7]} />
      <directionalLight
        position={[1200, 2200, 1400]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={-1700}
        shadow-camera-right={1700}
        shadow-camera-top={1700}
        shadow-camera-bottom={-1700}
        shadow-camera-near={100}
        shadow-camera-far={6000}
        shadow-bias={-0.0004}
      />
    </>
  );
}

export function GameCanvas() {
  const controller = useGame();
  return (
    <Canvas
      shadows
      orthographic
      dpr={[1, 2]}
      gl={{ antialias: true }}
      camera={{ position: [0, CAMERA_HEIGHT, 1], zoom: 0.5, near: 10, far: CAMERA_HEIGHT * 3 }}
      onPointerMissed={() => controller.select(null)}
    >
      <GameLoop />
      <color attach="background" args={[SKY]} />
      <Lighting />
      <AirportScene />
      <ApproachGuides />
      <AircraftLayer />
      <SelectedRoute />
      <CrashEffects />
      <CameraRig />
    </Canvas>
  );
}
