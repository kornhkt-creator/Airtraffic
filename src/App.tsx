import { useEffect, useState } from 'react';
import { GameController } from './game/GameController';
import { GameProvider } from './game/GameContext';
import { installDebugHook } from './game/debugHook';
import { GameCanvas } from './scene/GameCanvas';
import { ScorePanel } from './ui/ScorePanel';
import { AircraftPanel } from './ui/AircraftPanel';
import { CommandPanel } from './ui/CommandPanel';
import { AlertPanel } from './ui/AlertPanel';
import { PauseBanner, StartScreen } from './ui/Overlays';

export function App() {
  const [controller] = useState(() => new GameController());

  useEffect(() => {
    if (import.meta.env.DEV) return installDebugHook(controller);
    return undefined;
  }, [controller]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'p' || e.key === 'P') controller.togglePause();
      if (e.key === 'Escape') controller.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  return (
    <GameProvider controller={controller}>
      <div className="app">
        <ScorePanel />
        <main className="layout">
          <AircraftPanel />
          <section className="viewport">
            <GameCanvas />
            <PauseBanner />
            <AlertPanel />
            <StartScreen />
          </section>
          <CommandPanel />
        </main>
      </div>
    </GameProvider>
  );
}
