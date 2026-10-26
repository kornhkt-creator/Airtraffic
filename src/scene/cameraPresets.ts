export type CameraView = 'airport';

/** Sim-coordinate area (x east, y north, meters) a view frames on screen. */
export interface CameraPreset {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Height of the top-down orthographic camera above the ground (Three.js Y). */
export const CAMERA_HEIGHT = 6000;

/** Map view for the top-down 2D camera. */
export const CAMERA_PRESETS: Record<CameraView, CameraPreset> = {
  /** One screen for everything: holding stack, final approach, both runways, terminal and climb-out. */
  airport: { minX: -2450, maxX: 1180, minY: -1880, maxY: 1230 },
};
