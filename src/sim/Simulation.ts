import type { Aircraft, Alert, AlertSeverity, Command, CommandResult, GameStatus, SimEvent, Vec3 } from './types';
import type { SimWorld } from './world';
import type { AircraftView, SimSnapshot } from './snapshot';
import { SIM_CONFIG } from './config';
import { AIRPORT } from './airport/layout';
import { RouteManager } from './airport/RouteManager';
import { SimulationClock } from './SimulationClock';
import { Rng } from './rng';
import { ScoringSystem } from './ScoringSystem';
import { executeCommand, getCommandOptions, validateCommand, type CommandOption } from './CommandSystem';
import { getRunwayOccupants } from './safety/SafetySystem';
import { updateAircraft } from './aircraft/AircraftAI';
import { assignPath } from './aircraft/MovementSystem';
import { createHoldingLoop, glideAltitude } from './aircraft/navigation';
import type { Path } from './path/Path';
import { M_TO_FT, MS_TO_KT, toCompassDeg } from './math';

export interface SimulationOptions {
  seed?: number;
}

const INACTIVE = new Set(['AT_GATE', 'DEPARTED', 'DIVERTED', 'CRASHED']);

/**
 * The complete game simulation in plain TypeScript (no React, no Three.js). Rendering reads from
 * it; the UI talks to it only through commands and snapshots.
 */
export class Simulation implements SimWorld {
  readonly clock = new SimulationClock();
  readonly routes = new RouteManager(AIRPORT);
  readonly holdingLoop: Path = createHoldingLoop(AIRPORT);
  readonly scoring = new ScoringSystem();

  status: GameStatus = 'MENU';
  time = 0;
  tick = 0;
  aircraft: Aircraft[] = [];
  alerts: Alert[] = [];

  private seed: number;
  private rng: Rng;
  private events: SimEvent[] = [];
  private nextAircraftNumber = 1;
  private nextAlertId = 1;

  constructor(options: SimulationOptions = {}) {
    this.seed = options.seed ?? 1;
    this.rng = new Rng(this.seed);
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
    this.events = [];
    this.nextAircraftNumber = 1;
    this.nextAlertId = 1;
  }

  start(): void {
    if (this.status !== 'MENU') return;
    this.status = 'RUNNING';
    this.spawnArrival();
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
    for (const ac of this.aircraft) {
      ac.prev = { position: { ...ac.position }, altitude: ac.altitude, heading: ac.heading };
      updateAircraft(this, ac, dt);
    }
    this.processEvents();
    this.alerts = this.alerts.filter((a) => a.expiresAt === null || a.expiresAt > this.time);
  }

  // ---- World access ----------------------------------------------------------------------

  getAircraft(id: string): Aircraft | undefined {
    return this.aircraft.find((a) => a.id === id);
  }

  emit(event: SimEvent): void {
    this.events.push(event);
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

  spawnArrival(): Aircraft {
    const number = this.nextAircraftNumber++;
    const callsign = `${this.rng.pick(SIM_CONFIG.callsignPrefixes)}${this.rng.int(100, 989)}`;
    const s = this.rng.range(0, this.holdingLoop.length * 0.2);
    const sample = this.holdingLoop.sample(s);
    const ac: Aircraft = {
      id: `AC${number}`,
      callsign,
      flightType: 'ARRIVAL',
      status: 'APPROACH',
      position: sample.position,
      altitude: SIM_CONFIG.air.holdingAltitude,
      heading: sample.heading,
      speed: SIM_CONFIG.air.approachSpeed,
      prev: { position: { ...sample.position }, altitude: SIM_CONFIG.air.holdingAltitude, heading: sample.heading },
      nav: { path: null, s: 0, endSpeed: 0, kind: 'none', version: 0 },
      routeNodeIds: [],
      pendingRoute: null,
      exitNodeId: null,
      destinationId: null,
      gateId: null,
      onRunway: false,
      waitTime: 0,
    };
    assignPath(ac, this.holdingLoop, 'holding', SIM_CONFIG.air.approachSpeed);
    ac.nav.s = s;
    this.aircraft.push(ac);
    this.pushAlert('info', `${callsign} is holding and requesting landing clearance.`, ac.id);
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
      } else if (e.type === 'RUNWAY_VACATED' && !ac.pendingRoute && ac.status === 'LANDED') {
        this.pushAlert('info', `${ac.callsign} vacated the runway and is waiting for taxi clearance.`, ac.id);
      } else if (e.type === 'FLIGHT_COMPLETED') {
        const points = this.scoring.recordCompletion(ac.id);
        if (points !== null) {
          const gate = ac.gateId ? this.routes.label(ac.gateId) : 'the gate';
          this.pushAlert('success', `${ac.callsign} parked at ${gate}. +${points}`, ac.id);
        }
      }
    }
  }

  pushAlert(severity: AlertSeverity, message: string, aircraftId: string | null = null): void {
    const baseTtl = severity === 'critical' ? null : severity === 'warning' ? SIM_CONFIG.alerts.warningTtl : SIM_CONFIG.alerts.infoTtl;
    // TTLs are in sim seconds; scale them so alerts stay readable for the same real time at 2x/4x.
    const ttl = baseTtl === null ? null : baseTtl * this.clock.timeScale;
    this.alerts.unshift({
      id: this.nextAlertId++,
      severity,
      message,
      time: this.time,
      expiresAt: ttl === null ? null : this.time + ttl,
      aircraftId,
    });
    this.alerts = this.alerts.slice(0, SIM_CONFIG.alerts.maxAlerts);
  }

  // ---- Read models -----------------------------------------------------------------------

  /** Planned route of an aircraft as 3D points (sim coordinates), for drawing route lines. */
  getPlannedRoute(aircraftId: string): Vec3[] {
    const ac = this.getAircraft(aircraftId);
    const path = ac?.nav.path;
    if (!ac || !path) return [];
    const airborne = ac.nav.kind === 'holding' || ac.nav.kind === 'approach';
    const points: Vec3[] = path.samplePoints(airborne ? 120 : 8).map(({ s, position }) => ({
      x: position.x,
      y: position.y,
      alt: ac.nav.kind === 'approach' ? glideAltitude(path.length - s) : ac.nav.kind === 'holding' ? SIM_CONFIG.air.holdingAltitude : 0,
    }));
    if (ac.pendingRoute) {
      for (const p of this.routes.positions(ac.pendingRoute.slice(1))) points.push({ x: p.x, y: p.y, alt: 0 });
    }
    return points;
  }

  private describeTarget(ac: Aircraft): string {
    switch (ac.status) {
      case 'APPROACH':
        return 'Holding — awaiting landing clearance';
      case 'LANDING':
        return `Cleared to land RWY ${this.routes.layout.runway.designators[0]}`;
      case 'LANDED': {
        const exit = ac.exitNodeId ? this.routes.label(ac.exitNodeId) : 'runway exit';
        if (ac.pendingRoute && ac.destinationId) return `Vacating via ${exit}, then ${this.routes.label(ac.destinationId)}`;
        return ac.onRunway ? `Rolling out — vacating via ${exit}` : `Clear of runway at ${exit} — awaiting taxi`;
      }
      case 'TAXIING':
        return ac.destinationId ? `Taxiing to ${this.routes.label(ac.destinationId)} via ${this.routes.describeRoute(ac.routeNodeIds)}` : 'Taxiing';
      case 'AT_GATE':
        return ac.gateId ? `Parked at ${this.routes.label(ac.gateId)}` : 'Parked';
      default:
        return ac.status;
    }
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
      commands: getCommandOptions(this, ac),
    }));
    return {
      status: this.status,
      time: this.time,
      timeScale: this.clock.timeScale,
      score: this.scoring.score,
      completedFlights: this.scoring.completedFlights,
      activeFlights: this.aircraft.filter((a) => !INACTIVE.has(a.status)).length,
      aircraft: views,
      alerts: this.alerts.map((a) => ({ ...a })),
      runwayOccupiedBy: getRunwayOccupants(this.aircraft).map((a) => a.callsign),
    };
  }
}
