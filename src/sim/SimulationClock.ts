import { SIM_CONFIG } from './config';

/**
 * Fixed-timestep clock (accumulator pattern). Real frame time is converted into a whole number of
 * simulation ticks, so the simulation is independent of the render frame rate.
 */
export class SimulationClock {
  readonly dt: number;
  timeScale = 1;
  private accumulator = 0;

  constructor(
    tickRate: number = SIM_CONFIG.tickRate,
    private readonly maxFrameDelta: number = SIM_CONFIG.maxFrameDelta,
    private readonly maxSteps: number = SIM_CONFIG.maxStepsPerFrame,
  ) {
    this.dt = 1 / tickRate;
  }

  /** Adds real elapsed seconds and returns how many fixed ticks should run now. */
  consume(realDelta: number): number {
    const delta = Math.min(Math.max(realDelta, 0), this.maxFrameDelta) * this.timeScale;
    this.accumulator += delta;
    let steps = Math.floor(this.accumulator / this.dt + 1e-9);
    if (steps > this.maxSteps) {
      steps = this.maxSteps;
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * this.dt;
    }
    return steps;
  }

  /** Fraction (0..1) of the next tick already elapsed; used for render interpolation. */
  get alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / this.dt));
  }

  reset(): void {
    this.accumulator = 0;
    this.timeScale = 1;
  }
}
