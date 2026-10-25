export type CameraView = 'airport' | 'airspace';

export interface CameraPreset {
  position: [number, number, number];
  target: [number, number, number];
}

/** Camera presets in Three.js coordinates (x east, y up, z south). */
export const CAMERA_PRESETS: Record<CameraView, CameraPreset> = {
  /** Runway, taxiways and apron fill the view. */
  airport: { position: [0, 1500, 2280], target: [0, 0, 300] },
  /** Whole airspace: holding stack, final approach and the airport. */
  airspace: { position: [-1600, 6600, 3400], target: [-1600, 0, -1000] },
};
