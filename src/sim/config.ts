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
    /** Lowest holding level; the only one cleared aircraft leave from. */
    holdingAltitude: 450,
    /** Holding stack levels (≥ 300 m apart so stacked aircraft stay vertically separated). */
    holdingLevels: [450, 800, 1150, 1500] as const,
    /** A cleared arrival keeps its stack level until it is this far below the bottom level. */
    stackClearance: 300,
    /** LAND is accepted only from the bottom level, within this altitude tolerance. */
    landingAltitudeTolerance: 100,
    /** Seconds in the holding pattern before an arrival diverts. */
    maxHoldingTime: 180,
    /** Warning issued this many seconds before a diversion. */
    divertWarning: 30,
    /** Diverting aircraft fly this far away from the holding fix before leaving the simulation. */
    divertDistance: 6000,
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
    pushbackSpeed: 2,
    pushbackAccel: 0.5,
    /** Distance pushed back along the apron lane after leaving the stand. */
    pushbackLength: 70,
    /** Other ground traffic closer than this to the pushback area blocks PUSHBACK. */
    pushbackClearance: 70,
    /** Line-up point distance past the runway entry node. */
    lineUpDistance: 70,
  },

  departure: {
    takeoffAccel: 2.5,
    rotationSpeed: 75,
    climbSpeed: 85,
    climbRate: 8,
    climbAltitude: 900,
    /** Straight-out distance past the runway end at which the flight is handed off (DEPARTED). */
    handoffDistance: 7000,
  },

  traffic: {
    /** Seconds over which difficulty ramps from the start to the end values below. */
    rampDuration: 720,
    arrivalInterval: { start: [45, 90], end: [20, 40] },
    departureInterval: { start: [60, 120], end: [30, 60] },
    maxActive: { start: 4, end: 8 },
    maxAirborneArrivals: { start: 2, end: 4 },
    /** When a spawn is blocked (caps, no gate, no level), try again after this many seconds. */
    retryDelay: 5,
    /** Arrivals appear this far from the holding fix, within the bearing range (math degrees). */
    spawnDistance: 5500,
    spawnBearingDeg: [100, 220],
    /** Seconds a parked arrival spends at the gate before it becomes a departure. */
    turnaroundTime: 60,
    /** Scheduled departures never take the last free gate(s), so arrivals can still park. */
    keepFreeGates: 1,
    difficultyLevels: 5,
  },

  scoring: {
    arrivalCompleted: 100,
    departureCompleted: 100,
    diversionPenalty: 50,
  },

  alerts: {
    infoTtl: 6,
    warningTtl: 10,
    maxAlerts: 8,
  },

  callsignPrefixes: ['SKL', 'AZR', 'NVX', 'ORB', 'PLM', 'KTA', 'VRN', 'HLX'] as const,
} as const;

export type SimConfig = typeof SIM_CONFIG;
