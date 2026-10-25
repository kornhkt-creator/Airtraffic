import type { GameController } from './GameController';
import type { Command, CommandResult } from '../sim/types';
import type { SimSnapshot } from '../sim/snapshot';

/** Development/test-only handle so browser tests can drive the game without clicking WebGL pixels. */
export interface SimDebugApi {
  snapshot(): SimSnapshot;
  start(): void;
  restart(): void;
  command(cmd: Command): CommandResult;
  /** Runs n simulation ticks synchronously (fast-forward). */
  stepTicks(n: number): void;
  select(id: string | null): void;
}

declare global {
  interface Window {
    __sim?: SimDebugApi;
  }
}

export function installDebugHook(controller: GameController): () => void {
  window.__sim = {
    snapshot: () => controller.sim.snapshot(),
    start: () => controller.start(),
    restart: () => controller.restart(),
    command: (cmd) => controller.command(cmd),
    stepTicks: (n) => {
      for (let i = 0; i < n; i++) controller.sim.step();
      controller.publish();
    },
    select: (id) => controller.select(id),
  };
  return () => {
    delete window.__sim;
  };
}
