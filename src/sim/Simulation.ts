import type { Aircraft, Alert, AlertSeverity, Command, CommandResult, CrashInfo, GameStatus, SimEvent, Vec2, Vec3 } from './types';
import type { SimWorld } from './world';
import type { AircraftView, RunwayView, SimSnapshot } from './snapshot';
import { SIM_CONFIG } from './config';
import { AIRPORT } from './airport/layout';
import { RouteManager } from './airport/RouteManager';
import { SimulationClock } from './SimulationClock';
import { Rng } from './rng';
import { ScoringSystem } from './ScoringSystem';
import { executeCommand, getCommandOptions, validateCommand, type CommandOption } from './CommandSystem';
import { findRunwayIncursions, getRunwayOccupants, runwayOf } from './safety/SafetySystem';
import { findAirConflicts, findCollisions, findHeadOn, findProximities, findRouteConflicts } from './safety/CollisionSystem';
import { transition } from './aircraft/AircraftStateMachine';
import { updateAircraft } from './aircraft/AircraftAI';
import { assignPath } from './aircraft/MovementSystem';
import { apronNodeOf, createHoldingLoop, glideAltitude, planInbound } from './aircraft/navigation';
import { compactHoldingStack, freeHoldingLevel, levelAltitude } from './aircraft/holdingStack';
import { difficultyLevel, isActiveFlight, SpawnSystem } from './SpawnSystem';
import type { Path } from './path/Path';
import { fromAngle, M_TO_FT, MS_TO_KT, toCompassDeg } from './math';

export interface SimulationOptions {
  seed?: number;
  /** Schedule new traffic automatically (default true). Tests disable it for isolated scenarios. */
  autoSpawn?: boolean;
}

/**
 * The complete game simulation in plain TypeScript (no React, no Three.js). Rendering reads from
 * it; the UI talks to it only through commands and snapshots.
 */
export class Simulation implements SimWorld {
  readonly clock = new SimulationClock();
  readonly routes = new RouteManager(AIRPORT);
  readonly holdingLoop: Path = createHoldingLoop(AIRPORT);
  readonly scoring = new ScoringSystem();
  readonly spawner = new SpawnSystem();
  readonly autoSpawn: boolean;

  status: GameStatus = 'MENU';
  time = 0;
  tick = 0;
  aircraft: Aircraft[] = [];
  alerts: Alert[] = [];
  /** The collision that ended the game (set exactly once per game). */
  crash: CrashInfo | null = null;

  private seed: number;
  private rng: Rng;
  private events: SimEvent[] = [];
  private nextAircraftNumber = 1;
  private nextAlertId = 1;
  /** Conflicts active last tick → their alert id, so each is announced once and stays visible while it lasts. */
  private conflictAlerts = new Map<string, number>();

  constructor(options: SimulationOptions = {}) {
    this.seed = options.seed ?? 1;
    this.rng = new Rng(this.seed);
    this.autoSpawn = options.autoSpawn ?? true;
  }

  // ---- Game flow -------------------------------------------------------------------------

  reset(seed: number = this.seed): void {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.clock.reset();
    this.scoring.reset();
    this.status = 'MENU';
    this.time = 0;
    this.tick = 0;
    this.aircraft = [];
    this.alerts = [];
    this.crash = null;
    this.conflictAlerts.clear();
    this.events = [];
    this.nextAircraftNumber = 1;
    this.nextAlertId = 1;
  }

  start(): void {
    if (this.status !== 'MENU') return;
    this.status = 'RUNNING';
    this.spawnArrival({ inbound: false });
    this.spawnDeparture();
    this.spawner.reset(this.time, this.rng);
  }

  restart(seed?: number): void {
    this.reset(seed);
    this.start();
  }

  pause(): void {
    if (this.status === 'RUNNING') this.status = 'PAUSED';
  }

  resume(): void {
    if (this.status === 'PAUSED') this.status = 'RUNNING';
  }

  togglePause(): void {
    if (this.status === 'RUNNING') this.pause();
    else this.resume();
  }

  setTimeScale(scale: number): void {
    if (!(SIM_CONFIG.timeScales as readonly number[]).includes(scale)) throw new Error(`Unsupported time scale ${scale}`);
    this.clock.timeScale = scale;
  }

  // ---- Simulation stepping ---------------------------------------------------------------

  /** Feeds real elapsed time into the fixed-step clock. Returns the number of ticks executed. */
  advance(realDelta: number): number {
    if (this.status !== 'RUNNING') return 0;
    const steps = this.clock.consume(realDelta);
    for (let i = 0; i < steps; i++) this.step();
    return steps;
  }

  /** Runs exactly one fixed tick. */
  step(): void {
    if (this.status !== 'RUNNING') return;
    const dt = this.clock.dt;
    this.time += dt;
    this.tick += 1;
    compactHoldingStack(this.aircraft);
    for (const ac of this.aircraft) {
      ac.prev = { position: { ...ac.position }, altitude: ac.altitude, heading: ac.heading };
      updateAircraft(this, ac, dt);
    }
    this.processEvents();
    if (this.checkCollisions()) return;
    this.updateConflicts();
    this.spawner.update(this, this.rng, this.autoSpawn);
    this.alerts = this.alerts.filter((a) => a.expiresAt === null || a.expiresAt > this.time);
  }

  // ---- Safety ----------------------------------------------------------------------------

  /** A confirmed collision crashes both aircraft and ends the game, exactly once. */
  private checkCollisions(): boolean {
    if (this.crash) return true;
    const hit = findCollisions(this.aircraft)[0];
    if (!hit) return false;
    const { a, b } = hit;
    for (const ac of [a, b]) {
      transition(ac, 'CRASHED', (e) => this.emit(e));
      ac.speed = 0;
      ac.conflict = true;
      assignPath(ac, null, 'none', 0);
    }
    this.crash = {
      aircraftIds: [a.id, b.id],
      callsigns: [a.callsign, b.callsign],
      position: { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 },
      altitude: (a.altitude + b.altitude) / 2,
      time: this.time,
    };
    this.status = 'GAME_OVER';
    this.events = [];
    this.pushAlert('critical', `COLLISION — ${a.callsign} and ${b.callsign} collided. Game over.`, a.id);
    return true;
  }

  /** Flags aircraft that are dangerously close and announces each new conflict once. */
  private updateConflicts(): void {
    for (const ac of this.aircraft) ac.conflict = false;
    const active = new Map<string, number>();
    const raise = (key: string, message: string, aircraftId: string): void => {
      if (active.has(key)) return; // already reported this tick by another detector
      const id = this.conflictAlerts.get(key);
      const alert = id === undefined ? undefined : this.alerts.find((x) => x.id === id);
      if (alert) {
        // Still in conflict: keep the warning on screen until it is resolved.
        alert.expiresAt = this.time + SIM_CONFIG.alerts.warningTtl * this.clock.timeScale;
        active.set(key, alert.id);
      } else if (id !== undefined) {
        active.set(key, id);
      } else {
        active.set(key, this.pushAlert('warning', message, aircraftId));
      }
    };
    for (const { a, b } of findProximities(this.aircraft, SIM_CONFIG.safety.conflictBuffer)) {
      // Two stationary aircraft cannot close in on each other.
      if (a.speed < 0.1 && b.speed < 0.1) continue;
      a.conflict = true;
      b.conflict = true;
      const key = [a.id, b.id].sort().join('|');
      raise(key, `Traffic conflict — ${a.callsign} and ${b.callsign} are dangerously close!`, a.id);
    }
    const headOn = [...findRouteConflicts(this.aircraft, this.routes), ...findHeadOn(this.aircraft)];
    for (const { a, b } of headOn) {
      a.conflict = true;
      b.conflict = true;
      const key = `head-on|${[a.id, b.id].sort().join('|')}`;
      raise(key, `Head-on traffic — ${a.callsign} and ${b.callsign} are taxiing toward each other. Hold one of them!`, a.id);
    }
    for (const { a, b } of findAirConflicts(this.aircraft)) {
      a.conflict = true;
      b.conflict = true;
      const key = `air|${[a.id, b.id].sort().join('|')}`;
      raise(key, `Separation lost — ${a.callsign} and ${b.callsign} are too close in the air.`, a.id);
    }
    for (const { ac, runway } of findRunwayIncursions(this.aircraft, this.routes.layout)) {
      ac.conflict = true;
      const key = `incursion|${ac.id}|${runway.id}`;
      raise(key, `RUNWAY INCURSION — ${ac.callsign} is on runway ${runway.designators[0]} without clearance!`, ac.id);
    }
    this.conflictAlerts = active;
  }

  // ---- World access ----------------------------------------------------------------------

  getAircraft(id: string): Aircraft | undefined {
    return this.aircraft.find((a) => a.id === id);
  }

  emit(event: SimEvent): void {
    this.events.push(event);
  }

  removeAircraft(id: string): void {
    this.aircraft = this.aircraft.filter((a) => a.id !== id);
  }

  // ---- Commands --------------------------------------------------------------------------

  issueCommand(cmd: Command): CommandResult {
    const validation = validateCommand(this, cmd);
    const callsign = this.getAircraft(cmd.aircraftId)?.callsign ?? cmd.aircraftId;
    if (!validation.ok) {
      this.pushAlert('warning', `${cmd.type} rejected — ${validation.reason}`, cmd.aircraftId);
      return { ok: false, message: validation.reason };
    }
    const message = executeCommand(this, cmd, validation);
    this.processEvents();
    this.pushAlert('info', message, cmd.aircraftId);
    return { ok: true, message: message || `${callsign}: ${cmd.type}` };
  }

  getCommandOptions(aircraftId: string): CommandOption[] {
    const ac = this.getAircraft(aircraftId);
    return ac ? getCommandOptions(this, ac) : [];
  }

  // ---- Spawning --------------------------------------------------------------------------

  private newCallsign(): string {
    for (;;) {
      const callsign = `${this.rng.pick(SIM_CONFIG.callsignPrefixes)}${this.rng.int(100, 989)}`;
      if (!this.aircraft.some((a) => a.callsign === callsign)) return callsign;
    }
  }

  private createAircraft(flightType: Aircraft['flightType'], status: Aircraft['status'], position: Vec2, heading: number, altitude: number, speed: number): Aircraft {
    return {
      id: `AC${this.nextAircraftNumber++}`,
      callsign: this.newCallsign(),
      flightType,
      status,
      position: { ...position },
      altitude,
      heading,
      speed,
      prev: { position: { ...position }, altitude, heading },
      nav: { path: null, s: 0, endSpeed: 0, kind: 'none', reverse: false, version: 0 },
      routeNodeIds: [],
      pendingRoute: null,
      exitNodeId: null,
      destinationId: null,
      gateId: null,
      holdingPointId: null,
      pushback: null,
      onRunway: false,
      waitTime: 0,
      holdingLevel: null,
      divertWarned: false,
      gateTime: 0,
      conflict: false,
      taxiHold: false,
    };
  }

  /**
   * Adds an arrival on its own holding-stack level. `inbound` arrivals appear away from the airport
   * and fly to the holding pattern; otherwise they start inside it. Returns null when the stack is full.
   */
  spawnArrival(options: { inbound: boolean } = { inbound: true }): Aircraft | null {
    const level = freeHoldingLevel(this.aircraft);
    if (level === null) return null;
    const altitude = levelAltitude(level);
    const speed = SIM_CONFIG.air.approachSpeed;
    let ac: Aircraft;
    if (options.inbound) {
      const t = SIM_CONFIG.traffic;
      const bearing = (this.rng.range(t.spawnBearingDeg[0], t.spawnBearingDeg[1]) * Math.PI) / 180;
      const center = this.routes.layout.approach.holdingCenter;
      const dir = fromAngle(bearing);
      const position = { x: center.x + dir.x * t.spawnDistance, y: center.y + dir.y * t.spawnDistance };
      const heading = bearing + Math.PI;
      ac = this.createAircraft('ARRIVAL', 'APPROACH', position, heading, altitude, speed);
      assignPath(ac, planInbound({ position, heading }, this.holdingLoop), 'inbound', speed);
    } else {
      const s = this.rng.range(0, this.holdingLoop.length * 0.2);
      const sample = this.holdingLoop.sample(s);
      ac = this.createAircraft('ARRIVAL', 'APPROACH', sample.position, sample.heading, altitude, speed);
      assignPath(ac, this.holdingLoop, 'holding', speed);
      ac.nav.s = s;
    }
    ac.holdingLevel = level;
    this.aircraft.push(ac);
    const where = options.inbound ? 'inbound to the holding fix' : 'is holding';
    this.pushAlert('info', `${ac.callsign} ${where}, requesting landing clearance.`, ac.id);
    return ac;
  }

  /** Gates nobody is parked at, taxiing to, or pushing back from. */
  freeGates(): string[] {
    return this.routes.layout.gateIds.filter((id) => !this.aircraft.some((a) => a.gateId === id || a.destinationId === id));
  }

  /** Places a departure at a free gate (nose-in toward the terminal). Returns null when all gates are taken. */
  spawnDeparture(gateId?: string): Aircraft | null {
    const free = this.freeGates();
    const gate = gateId ?? (free.length > 0 ? this.rng.pick(free) : undefined);
    if (!gate || !free.includes(gate)) return null;
    const gatePos = this.routes.node(gate).position;
    const apronPos = this.routes.node(apronNodeOf(gate, this.routes)).position;
    const heading = Math.atan2(gatePos.y - apronPos.y, gatePos.x - apronPos.x);
    const ac = this.createAircraft('DEPARTURE', 'AT_GATE', gatePos, heading, 0, 0);
    ac.gateId = gate;
    this.aircraft.push(ac);
    this.pushAlert('info', `${ac.callsign} at ${this.routes.label(gate)} is requesting pushback.`, ac.id);
    return ac;
  }

  // ---- Events & alerts -------------------------------------------------------------------

  private processEvents(): void {
    const events = this.events;
    this.events = [];
    for (const e of events) {
      const ac = this.getAircraft(e.aircraftId);
      if (!ac) continue;
      if (e.type === 'STATUS_CHANGED' && e.to === 'LANDED') {
        this.pushAlert('info', `${ac.callsign} touched down.`, ac.id);
      } else if (e.type === 'STATUS_CHANGED' && e.to === 'HOLDING') {
        this.pushAlert('info', `${ac.callsign} holding short runway ${this.routes.layout.departureRunway.designators[0]}, ready for departure.`, ac.id);
      } else if (e.type === 'RUNWAY_VACATED' && !ac.pendingRoute && ac.status === 'LANDED') {
        this.pushAlert('info', `${ac.callsign} vacated the runway and is waiting for taxi clearance.`, ac.id);
      } else if (e.type === 'PUSHBACK_COMPLETED' && !ac.pendingRoute) {
        this.pushAlert('info', `${ac.callsign} pushback complete, ready to taxi.`, ac.id);
      } else if (e.type === 'DIVERT_WARNING') {
        this.pushAlert('warning', `${ac.callsign} low on fuel — will divert in ${e.secondsLeft} s without landing clearance.`, ac.id);
      } else if (e.type === 'FLIGHT_DIVERTED') {
        const points = this.scoring.recordPenalty(ac.id, 'diversion');
        if (points !== null) this.pushAlert('warning', `${ac.callsign} diverted to another airport. −${points}`, ac.id);
      } else if (e.type === 'FLIGHT_COMPLETED') {
        const points = this.scoring.recordCompletion(ac.id, ac.flightType);
        if (points !== null) {
          const gate = ac.gateId ? this.routes.label(ac.gateId) : 'the gate';
          const what = ac.flightType === 'ARRIVAL' ? `parked at ${gate}` : 'departed safely';
          this.pushAlert('success', `${ac.callsign} ${what}. +${points}`, ac.id);
        }
      }
    }
  }

  /** Adds an alert and returns its id. */
  pushAlert(severity: AlertSeverity, message: string, aircraftId: string | null = null): number {
    const baseTtl = severity === 'critical' ? null : severity === 'warning' ? SIM_CONFIG.alerts.warningTtl : SIM_CONFIG.alerts.infoTtl;
    // TTLs are in sim seconds; scale them so alerts stay readable for the same real time at 2x/4x.
    const ttl = baseTtl === null ? null : baseTtl * this.clock.timeScale;
    const id = this.nextAlertId++;
    this.alerts.unshift({
      id,
      severity,
      message,
      time: this.time,
      expiresAt: ttl === null ? null : this.time + ttl,
      aircraftId,
    });
    this.alerts = this.alerts.slice(0, SIM_CONFIG.alerts.maxAlerts);
    return id;
  }

  // ---- Read models -----------------------------------------------------------------------

  /** Planned route of an aircraft as 3D points (sim coordinates), for drawing route lines. */
  getPlannedRoute(aircraftId: string): Vec3[] {
    const ac = this.getAircraft(aircraftId);
    const path = ac?.nav.path;
    if (!ac || !path) return [];
    const kind = ac.nav.kind;
    const d = SIM_CONFIG.departure;
    const startS = ac.nav.s;
    const liftoff = (d.rotationSpeed * d.rotationSpeed) / (2 * d.takeoffAccel);
    const altitudeAt = (s: number): number => {
      if (kind === 'approach') return glideAltitude(path.length - s);
      if (kind === 'holding' || kind === 'inbound' || kind === 'divert') return levelAltitude(ac.holdingLevel);
      if (kind === 'takeoff') return Math.min(d.climbAltitude, ac.altitude + Math.max(0, s - startS - (ac.altitude > 0 ? 0 : liftoff)) * (d.climbRate / d.climbSpeed));
      return 0;
    };
    const airborne = kind === 'holding' || kind === 'inbound' || kind === 'divert' || kind === 'approach' || kind === 'takeoff';
    const points: Vec3[] = path.samplePoints(airborne ? 120 : 8).map(({ s, position }) => ({ x: position.x, y: position.y, alt: altitudeAt(s) }));
    if (ac.pendingRoute) {
      // A rollout ends on the route's first node; a pushback ends short of it.
      const rest = ac.status === 'PUSHBACK' ? ac.pendingRoute : ac.pendingRoute.slice(1);
      for (const p of this.routes.positions(rest)) points.push({ x: p.x, y: p.y, alt: 0 });
    }
    return points;
  }

  private describeTarget(ac: Aircraft): string {
    const rwy = runwayOf(ac, this.routes.layout).designators[0];
    switch (ac.status) {
      case 'APPROACH': {
        const level = ac.holdingLevel ?? 0;
        const ft = Math.round((levelAltitude(level) * M_TO_FT) / 100) * 100;
        if (ac.nav.kind === 'inbound') return `Inbound to holding fix — level ${level + 1} (${ft} ft)`;
        return level === 0 ? `Holding at ${ft} ft — ready for landing clearance` : `Holding at level ${level + 1} (${ft} ft) — descending in stack`;
      }
      case 'DIVERTED':
        return 'Diverting to alternate airport';
      case 'LANDING':
        return `Cleared to land RWY ${rwy}`;
      case 'LANDED': {
        const exit = ac.exitNodeId ? this.routes.label(ac.exitNodeId) : 'runway exit';
        if (ac.pendingRoute && ac.destinationId) return `Vacating via ${exit}, then ${this.routes.label(ac.destinationId)}`;
        return ac.onRunway ? `Rolling out — vacating via ${exit}` : `Clear of runway at ${exit} — awaiting taxi`;
      }
      case 'TAXIING':
        if (ac.taxiHold) return `Holding position${ac.destinationId ? ` — cleared to ${this.routes.label(ac.destinationId)} when released` : ''}`;
        // Stopped by the ground follow logic (e.g. queued for departure).
        if (ac.speed < 0.1 && ac.nav.path) return `Waiting behind traffic${ac.destinationId ? ` — then ${this.routes.label(ac.destinationId)}` : ''}`;
        return ac.destinationId ? `Taxiing to ${this.routes.label(ac.destinationId)} via ${this.routes.describeRoute(ac.routeNodeIds)}` : 'Taxiing';
      case 'AT_GATE': {
        const gate = ac.gateId ? this.routes.label(ac.gateId) : 'gate';
        return ac.flightType === 'DEPARTURE' ? `At ${gate} — ready for pushback` : `Parked at ${gate}`;
      }
      case 'PUSHBACK':
        if (ac.nav.path) return ac.pendingRoute && ac.destinationId ? `Pushing back, then taxi to ${this.routes.label(ac.destinationId)}` : 'Pushing back';
        return 'Pushback complete — awaiting taxi';
      case 'HOLDING':
        return `Holding short RWY ${rwy} at ${ac.holdingPointId ? this.routes.label(ac.holdingPointId) : 'holding point'}`;
      case 'LINE_UP':
        return ac.nav.path ? `Lining up RWY ${rwy}` : `Lined up RWY ${rwy} — awaiting takeoff clearance`;
      case 'TAKEOFF':
        return ac.altitude > 0 ? 'Climbing out' : `Takeoff roll RWY ${rwy}`;
      case 'DEPARTED':
        return 'Departed — handed off';
      default:
        return ac.status;
    }
  }

  private runwayViews(): RunwayView[] {
    const { layout } = this.routes;
    return [
      { runway: layout.arrivalRunway, use: 'ARRIVALS' as const },
      { runway: layout.departureRunway, use: 'DEPARTURES' as const },
    ].map(({ runway, use }) => ({
      designator: runway.designators[0],
      use,
      occupiedBy: getRunwayOccupants(this.aircraft, runway, layout).map((a) => a.callsign),
    }));
  }

  snapshot(): SimSnapshot {
    const views: AircraftView[] = this.aircraft.map((ac) => ({
      id: ac.id,
      callsign: ac.callsign,
      flightType: ac.flightType,
      status: ac.status,
      speedKt: Math.round(ac.speed * MS_TO_KT),
      altitudeFt: Math.round(ac.altitude * M_TO_FT),
      headingDeg: Math.round(toCompassDeg(ac.heading)) % 360,
      target: this.describeTarget(ac),
      waitTime: ac.waitTime,
      pathVersion: ac.nav.version,
      onRunway: ac.onRunway,
      holdingLevel: ac.holdingLevel,
      divertIn: ac.status === 'APPROACH' && ac.nav.kind === 'holding' ? Math.max(0, SIM_CONFIG.air.maxHoldingTime - ac.waitTime) : null,
      conflict: ac.conflict,
      commands: getCommandOptions(this, ac),
    }));
    return {
      status: this.status,
      time: this.time,
      timeScale: this.clock.timeScale,
      score: this.scoring.score,
      completedFlights: this.scoring.completedFlights,
      diversions: this.scoring.diversions,
      difficultyLevel: difficultyLevel(this.time),
      activeFlights: this.aircraft.filter(isActiveFlight).length,
      aircraft: views,
      alerts: this.alerts.map((a) => ({ ...a })),
      runways: this.runwayViews(),
      crash: this.crash ? { ...this.crash, position: { ...this.crash.position } } : null,
    };
  }
}
