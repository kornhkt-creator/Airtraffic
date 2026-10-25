import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { GameController, UiState } from './GameController';

const GameContext = createContext<GameController | null>(null);

export function GameProvider({ controller, children }: { controller: GameController; children: ReactNode }) {
  return <GameContext.Provider value={controller}>{children}</GameContext.Provider>;
}

export function useGame(): GameController {
  const controller = useContext(GameContext);
  if (!controller) throw new Error('useGame must be used inside <GameProvider>');
  return controller;
}

export function useGameStore<T>(selector: (state: UiState) => T): T {
  return useStore(useGame().store, selector);
}
