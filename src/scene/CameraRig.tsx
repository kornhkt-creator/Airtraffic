import { useEffect, useRef, type ElementRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useGameStore } from '../game/GameContext';

export const DEFAULT_CAMERA_POSITION: [number, number, number] = [-1600, 6600, 3400];
const DEFAULT_TARGET: [number, number, number] = [-1600, 0, -1000];

export function CameraRig() {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const resetToken = useGameStore((s) => s.cameraResetToken);

  useEffect(() => {
    camera.position.set(...DEFAULT_CAMERA_POSITION);
    controls.current?.target.set(...DEFAULT_TARGET);
    controls.current?.update();
  }, [camera, resetToken]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={DEFAULT_TARGET}
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
