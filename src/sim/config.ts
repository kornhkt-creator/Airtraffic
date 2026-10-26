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

  /**
   * Game aircraft size (meters). Deliberately about twice a real narrow-body so aircraft stay
   * readable from the overview camera; the airport layout spacing is sized for it.
   */
  aircraft: {
    length: 76,
    wingspan: 68,
  },

  /**
   * Airborne geometry is compressed (tight turns, low stack, steep glide path) so the holding
   * pattern, final approach and departure climb-out all fit on one screen with the airport.
   */
  air: {
    approachSpeed: 70,
    touchdownSpeed: 60,
    /** Turn radius used for airborne paths (≈14°/s at approach speed). */
    turnRadius: 280,
    /** Lowest holding level; the only one cleared aircraft leave from. */
    holdingAltitude: 250,
    /** Holding stack levels (≥ 200 m apart so stacked aircraft stay vertically separated). */
    holdingLevels: [250, 450, 650, 850] as const,
    /** A cleared arrival keeps its stack level until it is this far below the bottom level. */
    stackClearance: 200,
    /** LAND is accepted only from the bottom level, within this altitude tolerance. */
    landingAltitudeTolerance: 60,
    /** A go-around climbs straight ahead this far along the runway heading before turning back to the hold. */
    goAroundClimbOut: 1500,
    /** Arrivals waiting for a free stack level hold this far above the top level. */
    aboveStackMargin: 200,
    /** Seconds in the holding pattern before an arrival diverts. */
    maxHoldingTime: 180,
    /** Warning issued this many seconds before a diversion. */
    divertWarning: 30,
    /** Diverting aircraft fly this far away from the holding fix before leaving the simulation. */
    divertDistance: 1600,
    glideSlopeDeg: 8,
    maxVerticalSpeed: 12,
    accel: 1.5,
    decel: 1.5,
  },

  ground: {
    maxTaxiSpeed: 14,
    apronSpeed: 9,
    standSpeed: 4,
    runwayMaxSpeed: 80,
    /** Lateral acceleration limit used to derive safe turn speeds. */
    lateralAccel: 1.0,
    minTurnSpeed: 3,
    filletRadius: 40,
    accel: 1.0,
    taxiDecel: 1.5,
    rolloutDecel: 4.5,
    /** Extra distance kept when choosing a runway exit after touchdown. */
    exitMargin: 50,
    /** Speed kept at the runway exit when a taxi route is already assigned. */
    exitHandoffSpeed: 5,
    stopDecel: 3,
    pushbackSpeed: 3,
    pushbackAccel: 0.5,
    /** Distance pushed back along the apron lane after leaving the stand. */
    pushbackLength: 70,
    /**
     * Other ground traffic closer than this to the stand's apron node blocks PUSHBACK: it covers the
     * swept area (stand, lane and the 70 m push) plus room for taxiing traffic to stop.
     */
    pushbackClearance: 150,
    /** Line-up point distance past the runway entry node. */
    lineUpDistance: 70,
  },

  departure: {
    takeoffAccel: 3.5,
    rotationSpeed: 70,
    climbSpeed: 80,
    climbRate: 8,
    climbAltitude: 600,
    /** Straight-out distance past the runway end at which the flight is handed off (DEPARTED). */
    handoffDistance: 550,
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
    spawnDistance: 1000,
    spawnBearingDeg: [130, 230],
    /** Seconds a parked arrival spends at the gate before it becomes a departure. */
    turnaroundTime: 60,
    /** Scheduled departures never take the last free gate(s), so arrivals can still park. */
    keepFreeGates: 1,
    difficultyLevels: 5,
  },

  /** Collision and separation rules (simplified game rules, see safety/CollisionSystem.ts). */
  safety: {
    /** Aircraft closer than this vertically can collide; footprints are compared in 2D. */
    verticalClearance: 20,
    /** Footprints closer than this (edge to edge) raise a conflict warning. */
    conflictBuffer: 15,
    /** Ground follow logic: a taxiing aircraft looks this far ahead along its heading... */
    followLookahead: 220,
    /** ...within this lateral half-width... */
    followCorridor: 50,
    /** ...and stops this far (center to center) behind ground traffic it finds there. */
    followGap: 115,
    /** Taxiing aircraft closing head-on within this distance trigger a warning. */
    headOnLookahead: 450,
    /** Opposite-direction use of the same taxiway segment within this route distance is warned early. */
    headOnRouteLookahead: 800,
    /**
     * Airborne separation warning (a warning only, never game over): both aircraft above
     * `airMinAltitude`, closer than `airHorizontal` laterally and `airVertical` vertically. The
     * vertical limit stays below the 200 m holding-stack spacing so a normal stack never warns.
     */
    airHorizontal: 600,
    airVertical: 150,
    airMinAltitude: 30,
    /** A ground aircraft whose reference point is this close to a runway centerline is on the runway. */
    runwayStripHalfWidth: 45,
  },

  scoring: {
    arrivalCompleted: 100,
    departureCompleted: 100,
    diversionPenalty: 50,
    /** Each go-around. */
    goAroundPenalty: 20,
    /** For every full `delayThreshold` seconds a flight waits on the ground for an instruction. */
    delayPenalty: 10,
    delayThreshold: 60,
    /** Once per aircraft and runway entered without clearance. */
    incursionPenalty: 100,
    /** Once per pair that comes dangerously close (ground) or loses separation (air). */
    conflictPenalty: 25,
  },

  alerts: {
    infoTtl: 6,
    warningTtl: 10,
    maxAlerts: 8,
  },

  callsignPrefixes: ['SKL', 'AZR', 'NVX', 'ORB', 'PLM', 'KTA', 'VRN', 'HLX'] as const,
} as const;

export type SimConfig = typeof SIM_CONFIG;
