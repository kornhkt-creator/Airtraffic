import { useEffect, useState } from 'react';
import { useGame, useGameStore } from '../game/GameContext';
import { formatClock } from './format';

export function StartScreen() {
  const controller = useGame();
  const status = useGameStore((s) => s.snapshot.status);
  if (status !== 'MENU') return null;
  return (
    <div className="overlay">
      <div className="modal">
        <h1>Airport Traffic Control Simulator 3D</h1>
        <p className="lead">You are the controller at Suvarnabhumi International. Land arrivals on runway 01L, park them at the gates, and get departures airborne from runway 01R — no collisions.</p>
        <ol className="howto">
          <li>Select an aircraft from the list or click it on the map.</li>
          <li>
            <b>Arrivals:</b> <b>LAND</b> when the runway is clear, then <b>TAXI</b> to a free gate after touchdown.
          </li>
          <li>
            <b>Departures:</b> <b>PUSHBACK</b>, <b>TAXI</b> to the holding point, <b>LINE UP</b>, then <b>TAKEOFF</b>.
          </li>
          <li>
            Aircraft that touch <b>collide and end the game</b>. Watch for red rings and use <b>HOLD</b> to stop a taxiing aircraft — nobody can reverse on a taxiway.
          </li>
        </ol>
        <p className="muted small">Map: drag to pan, wheel to zoom. P pauses, H holds/continues the selected aircraft, Esc deselects.</p>
        <button type="button" className="btn primary large" onClick={() => controller.start()}>
          Start shift
        </button>
        <p className="disclaimer">Simplified game rules — not a real air traffic control system.</p>
      </div>
    </div>
  );
}

export function PauseBanner() {
  const status = useGameStore((s) => s.snapshot.status);
  if (status !== 'PAUSED') return null;
  return <div className="pause-banner">PAUSED — commands can still be issued</div>;
}

/** Shown once a collision ends the game: the crash plays out first, then the mission summary. */
export function GameOverScreen() {
  const controller = useGame();
  const crash = useGameStore((s) => s.snapshot.crash);
  const status = useGameStore((s) => s.snapshot.status);
  const score = useGameStore((s) => s.snapshot.score);
  const completed = useGameStore((s) => s.snapshot.completedFlights);
  const diversions = useGameStore((s) => s.snapshot.diversions);
  const [dismissed, setDismissed] = useState(false);
  // Snapshots are fresh objects every publish: reset only when a different crash happens.
  const crashKey = crash ? `${crash.time}:${crash.aircraftIds.join(',')}` : null;
  useEffect(() => setDismissed(false), [crashKey]);

  if (status !== 'GAME_OVER' || !crash) return null;
  if (dismissed) {
    return (
      <div className="game-over-banner">
        GAME OVER — {crash.callsigns.join(' × ')}
        <button type="button" className="btn primary" onClick={() => controller.restart()}>
          ↻ Play again
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="crash-flash" />
      <div className="overlay game-over">
        <div className="modal">
          <p className="game-over-kicker">💥 Collision</p>
          <h1>Game over</h1>
          <p className="lead">
            <b>{crash.callsigns[0]}</b> and <b>{crash.callsigns[1]}</b> collided at {formatClock(crash.time)}.
          </p>
          <dl className="summary">
            <div>
              <dt>Score</dt>
              <dd>{score}</dd>
            </div>
            <div>
              <dt>Completed flights</dt>
              <dd>{completed}</dd>
            </div>
            <div>
              <dt>Diversions</dt>
              <dd>{diversions}</dd>
            </div>
            <div>
              <dt>Shift time</dt>
              <dd>{formatClock(crash.time)}</dd>
            </div>
          </dl>
          <div className="game-over-actions">
            <button type="button" className="btn primary large" onClick={() => controller.restart()}>
              ↻ Play again
            </button>
            <button type="button" className="btn large" onClick={() => setDismissed(true)}>
              View crash site
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
