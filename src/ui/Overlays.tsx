import { useEffect, useState } from 'react';
import { useGame, useGameStore } from '../game/GameContext';
import { formatClock } from './format';
import type { MissionSummary } from '../sim/snapshot';
import type { PenaltyReason } from '../sim/ScoringSystem';

export function StartScreen() {
  const controller = useGame();
  const status = useGameStore((s) => s.snapshot.status);
  if (status !== 'MENU') return null;
  return (
    <div className="overlay">
      <div className="modal">
        <h1>Airport Traffic Control Simulator 3D</h1>
        <p className="lead">You are the controller at Suvarnabhumi International. Land arrivals on runway 01L or 01R, park them at the gates, and get departures airborne from runway 01R — no collisions.</p>
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
        {/* CSS shows the hint matching the device's pointer (mouse vs touch). */}
        <p className="muted small hint-mouse">Map: drag to pan, wheel to zoom. P pauses, H holds/continues the selected aircraft, Esc deselects.</p>
        <p className="muted small hint-touch">Map: drag to pan, pinch to zoom, tap an aircraft to select it. ✈ Flights opens the flight list.</p>
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
const PENALTY_ROWS: { reason: PenaltyReason; label: string }[] = [
  { reason: 'diversion', label: 'Diversions' },
  { reason: 'goAround', label: 'Go-arounds' },
  { reason: 'delay', label: 'Delays' },
  { reason: 'incursion', label: 'Runway incursions' },
  { reason: 'conflict', label: 'Traffic conflicts' },
];

/** Mission statistics shared by both end screens. */
function MissionSummaryTable({ summary }: { summary: MissionSummary }) {
  return (
    <>
      <dl className="summary">
        <div>
          <dt>Score</dt>
          <dd>{summary.score}</dd>
        </div>
        <div>
          <dt>Shift time</dt>
          <dd>{formatClock(summary.duration)}</dd>
        </div>
        <div>
          <dt>Arrivals parked</dt>
          <dd>{summary.completedArrivals}</dd>
        </div>
        <div>
          <dt>Departures</dt>
          <dd>{summary.completedDepartures}</dd>
        </div>
        <div>
          <dt>Level reached</dt>
          <dd>{summary.difficultyLevel}</dd>
        </div>
        <div>
          <dt>Penalty points</dt>
          <dd>{summary.penaltyPoints > 0 ? `\u2212${summary.penaltyPoints}` : 0}</dd>
        </div>
      </dl>
      <h3 className="section-title">Incidents</h3>
      <dl className="summary incidents">
        {PENALTY_ROWS.map(({ reason, label }) => (
          <div key={reason} className={summary.penalties[reason] > 0 ? 'has-incidents' : ''}>
            <dt>{label}</dt>
            <dd>{summary.penalties[reason]}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function GameOverScreen() {
  const controller = useGame();
  const crash = useGameStore((s) => s.snapshot.crash);
  const status = useGameStore((s) => s.snapshot.status);
  const endReason = useGameStore((s) => s.snapshot.endReason);
  const summary = useGameStore((s) => s.snapshot.summary);
  const [dismissed, setDismissed] = useState(false);
  // Snapshots are fresh objects every publish: reset only when a different game ends.
  const endKey = status === 'GAME_OVER' ? `${endReason}:${summary.duration}:${crash?.aircraftIds.join(',') ?? ''}` : null;
  useEffect(() => setDismissed(false), [endKey]);

  if (status !== 'GAME_OVER') return null;
  if (dismissed) {
    return (
      <div className="game-over-banner">
        {crash ? `GAME OVER — ${crash.callsigns.join(' × ')}` : 'SHIFT ENDED'}
        <button type="button" className="btn primary" onClick={() => controller.restart()}>
          ↻ Play again
        </button>
      </div>
    );
  }
  return (
    <>
      {crash && <div className="crash-flash" />}
      <div className={`overlay game-over ${crash ? '' : 'shift-ended'}`}>
        <div className="modal">
          {crash ? (
            <>
              <p className="game-over-kicker">💥 Collision</p>
              <h1>Game over</h1>
              <p className="lead">
                <b>{crash.callsigns[0]}</b> and <b>{crash.callsigns[1]}</b> collided at {formatClock(crash.time)}.
              </p>
            </>
          ) : (
            <>
              <p className="game-over-kicker shift">🏁 Shift ended</p>
              <h1>Mission summary</h1>
              <p className="lead">You handed over the airport with no collisions.</p>
            </>
          )}
          <MissionSummaryTable summary={summary} />
          <div className="game-over-actions">
            <button type="button" className="btn primary large" onClick={() => controller.restart()}>
              ↻ Play again
            </button>
            <button type="button" className="btn large" onClick={() => setDismissed(true)}>
              {crash ? 'View crash site' : 'Back to the map'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
