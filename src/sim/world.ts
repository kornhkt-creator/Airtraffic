import type { Aircraft, GameStatus, SimEvent } from './types';
import type { RouteManager } from './airport/RouteManager';
import type { Path } from './path/Path';

/** The slice of simulation state that systems (AI, commands, safety) are allowed to use. */
export interface SimWorld {
  readonly status: GameStatus;
  readonly time: number;
  readonly aircraft: readonly Aircraft[];
  readonly routes: RouteManager;
  readonly holdingLoop: Path;
  getAircraft(id: string): Aircraft | undefined;
  emit(event: SimEvent): void;
}
