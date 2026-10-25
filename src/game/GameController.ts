import { createStore, type StoreApi } from 'zustand/vanilla';
import { Simulation } from '../sim/Simulation';
import type { Command, CommandResult } from '../sim/types';
import type { SimSnapshot } from '../sim/snapshot';

export interface UiState {
  snapshot: SimSnapshot;
  selectedId: string | null;
  cameraResetToken: number;
}

/** UI snapshots are published at most this often (seconds); positions are read live by the 3D layer. */
const PUBLISH_INTERVAL = 0.1;

/**
 * Bridges the plain-TS simulation and React. Owns the simulation instance and a Zustand store of
 * throttled, serializable snapshots for the panels.
 */
export class GameController {
  readonly sim: Simulation;
  readonly store: StoreApi<UiState>;
  private sincePublish = 0;

  constructor(seed = Date.now() % 100000) {
    this.sim = new Simulation({ seed });
    this.store = createStore<UiState>(() => ({ snapshot: this.sim.snapshot(), selectedId: null, cameraResetToken: 0 }));
  }

  /** Called once per rendered frame with the real elapsed time. */
  frame(realDelta: number): void {
    this.sim.advance(realDelta);
    this.sincePublish += realDelta;
    if (this.sincePublish >= PUBLISH_INTERVAL) this.publish();
  }

  publish(): void {
    this.sincePublish = 0;
    const snapshot = this.sim.snapshot();
    const { selectedId } = this.store.getState();
    const stillExists = selectedId !== null && snapshot.aircraft.some((a) => a.id === selectedId);
    this.store.setState({ snapshot, selectedId: stillExists ? selectedId : null });
  }

  start(): void {
    this.sim.start();
    this.publish();
  }

  restart(): void {
    this.sim.restart();
    this.store.setState({ selectedId: null });
    this.publish();
  }

  togglePause(): void {
    this.sim.togglePause();
    this.publish();
  }

  setTimeScale(scale: number): void {
    this.sim.setTimeScale(scale);
    this.publish();
  }

  select(id: string | null): void {
    this.store.setState({ selectedId: id });
  }

  command(cmd: Command): CommandResult {
    const result = this.sim.issueCommand(cmd);
    this.publish();
    return result;
  }

  resetCamera(): void {
    this.store.setState((s) => ({ cameraResetToken: s.cameraResetToken + 1 }));
  }
}
