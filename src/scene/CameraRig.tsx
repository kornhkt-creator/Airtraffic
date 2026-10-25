import { useEffect, useRef, type ElementRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useGameStore } from '../game/GameContext';
import { CAMERA_PRESETS } from './cameraPresets';

export function CameraRig() {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const view = useGameStore((s) => s.cameraView);
  const resetToken = useGameStore((s) => s.cameraResetToken);

  useEffect(() => {
    const preset = CAMERA_PRESETS[view];
    camera.position.set(...preset.position);
    controls.current?.target.set(...preset.target);
    controls.current?.update();
  }, [camera, view, resetToken]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={CAMERA_PRESETS.airport.target}
      enableDamping
      dampingFactor={0.12}
      minDistance={60}
      maxDistance={14000}
      maxPolarAngle={Math.PI / 2 - 0.06}
      zoomSpeed={1.2}
      zoomToCursor
      screenSpacePanning={false}
    />
  );
}
