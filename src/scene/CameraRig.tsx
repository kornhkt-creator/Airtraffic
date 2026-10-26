import { useEffect, useRef, type ElementRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { MOUSE, TOUCH } from 'three';
import { useGameStore } from '../game/GameContext';
import { CAMERA_HEIGHT, CAMERA_PRESETS } from './cameraPresets';

/** Top-down 2D map camera: drag to pan, wheel to zoom, no rotation. */
export function CameraRig() {
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const getState = useThree((s) => s.get);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const view = useGameStore((s) => s.cameraView);
  const resetToken = useGameStore((s) => s.cameraResetToken);

  useEffect(() => {
    const b = CAMERA_PRESETS[view];
    const { size } = getState();
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    // A hair south of straight down keeps north at the top of the screen.
    camera.position.set(cx, CAMERA_HEIGHT, -cy + 1);
    camera.zoom = Math.min(size.width / (b.maxX - b.minX), size.height / (b.maxY - b.minY));
    camera.updateProjectionMatrix();
    controls.current?.target.set(cx, 0, -cy);
    controls.current?.update();
  }, [camera, getState, view, resetToken, width, height]); // refit on resize so the whole map stays on screen

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableRotate={false}
      enableDamping
      dampingFactor={0.15}
      minZoom={0.04}
      maxZoom={12}
      zoomSpeed={1.2}
      zoomToCursor
      screenSpacePanning
      mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
      touches={{ ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }}
    />
  );
}
