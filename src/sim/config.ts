/**
 * All tunable simulation values. Units: meters, m/s, m/s², seconds, degrees where noted.
 * These are simplified game rules, not real-world ATC or flight performance data.
 */
export const SIM_CONFIG = {
  /** Fixed simulation ticks per second. */
  tickRate: 20,
  /** Largest real-time frame delta accepted by the clock (prevents spiral of death). */
  maxFrameDelta: 0.25,
  maxStepsPerFrame: 40,
  timeScales: [1, 2, 4] as const,

  air: {
    approachSpeed: 70,
    touchdownSpeed: 65,
    /** Turn radius used for airborne paths (≈5.7°/s at approach speed). */
    turnRadius: 700,
    holdingAltitude: 450,
    glideSlopeDeg: 5.5,
    maxVerticalSpeed: 10,
    accel: 1.5,
    decel: 1.5,
  },

  ground: {
    maxTaxiSpeed: 10,
    apronSpeed: 7,
    standSpeed: 3,
    runwayMaxSpeed: 80,
    /** Lateral acceleration limit used to derive safe turn speeds. */
    lateralAccel: 1.0,
    minTurnSpeed: 3,
    filletRadius: 40,
    accel: 1.0,
    taxiDecel: 1.5,
    rolloutDecel: 3,
    /** Extra distance kept when choosing a runway exit after touchdown. */
    exitMargin: 50,
    /** Speed kept at the runway exit when a taxi route is already assigned. */
    exitHandoffSpeed: 5,
    stopDecel: 3,
  },

  scoring: {
    arrivalCompleted: 100,
  },

  alerts: {
    infoTtl: 6,
    warningTtl: 10,
    maxAlerts: 8,
  },

  callsignPrefixes: ['SKL', 'AZR', 'NVX', 'ORB', 'PLM', 'KTA', 'VRN', 'HLX'] as const,
} as const;

export type SimConfig = typeof SIM_CONFIG;
