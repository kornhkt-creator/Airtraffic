import { useEffect, useState } from 'react';
import { GameController } from './game/GameController';
import { GameProvider, useGame, useGameStore } from './game/GameContext';
import { installDebugHook } from './game/debugHook';
import { GameCanvas } from './scene/GameCanvas';
import { ScorePanel } from './ui/ScorePanel';
import { AircraftPanel } from './ui/AircraftPanel';
import { CommandPanel } from './ui/CommandPanel';
import { AlertPanel } from './ui/AlertPanel';
import { GameOverScreen, PauseBanner, StartScreen } from './ui/Overlays';

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
      if (e.key === 'h' || e.key === 'H') controller.toggleHold();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  return (
    <GameProvider controller={controller}>
      <AppShell />
    </GameProvider>
  );
}

/**
 * Page layout. CSS picks the arrangement per screen size: three columns on desktop; on tablets the
 * flight list becomes a drawer; on phones the command panel becomes a bottom sheet as well. The
 * classes below tell the CSS which drawers are open.
 */
function AppShell() {
  const controller = useGame();
  const hasSelection = useGameStore((s) => s.selectedId !== null);
  const flightsOpen = useGameStore((s) => s.flightsOpen);
  const flightCount = useGameStore((s) => s.snapshot.activeFlights);

  return (
    <div className={`app ${hasSelection ? 'has-selection' : ''} ${flightsOpen ? 'flights-open' : ''}`}>
      <ScorePanel />
      <main className="layout">
        <AircraftPanel />
        <section className="viewport">
          <GameCanvas />
          <button type="button" className="flights-toggle" aria-expanded={flightsOpen} onClick={() => controller.setFlightsOpen(!flightsOpen)}>
            ✈ Flights <span className="flights-count">{flightCount}</span>
          </button>
          {flightsOpen && <div className="drawer-backdrop" onClick={() => controller.setFlightsOpen(false)} />}
          <PauseBanner />
          <AlertPanel />
          <StartScreen />
          <GameOverScreen />
        </section>
        <CommandPanel />
      </main>
    </div>
  );
}
