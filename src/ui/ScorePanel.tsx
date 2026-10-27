import { useGame, useGameStore } from '../game/GameContext';
import { SIM_CONFIG } from '../sim/config';
import { formatClock } from './format';

/** Top HUD: score, time, flights and simulation controls. */
export function ScorePanel() {
  const controller = useGame();
  const status = useGameStore((s) => s.snapshot.status);
  const time = useGameStore((s) => s.snapshot.time);
  const score = useGameStore((s) => s.snapshot.score);
  const active = useGameStore((s) => s.snapshot.activeFlights);
  const completed = useGameStore((s) => s.snapshot.completedFlights);
  const diversions = useGameStore((s) => s.snapshot.diversions);
  const level = useGameStore((s) => s.snapshot.difficultyLevel);
  const timeScale = useGameStore((s) => s.snapshot.timeScale);
  const runways = useGameStore((s) => s.snapshot.runways);
  const inGame = status === 'RUNNING' || status === 'PAUSED';

  return (
    <header className="hud">
      <div className="brand">
        <span className="brand-mark">ATC</span>
        <span className="brand-name">Airport Traffic Control Simulator 3D</span>
      </div>
      <div className="hud-stats">
        <Stat label="Score" value={String(score)} />
        <Stat label="Time" value={formatClock(time)} />
        <Stat label="Level" value={`${level} / ${SIM_CONFIG.traffic.difficultyLevels}`} />
        <Stat label="Active" value={String(active)} />
        <Stat label="Completed" value={String(completed)} />
        <Stat label="Diverted" value={String(diversions)} tone={diversions > 0 ? 'warn' : undefined} />
        {runways.map((r) => (
          <Stat
            key={r.designator}
            label={`RWY ${r.designator} ${r.use === 'ARRIVALS' ? 'ARR' : r.use === 'MIXED' ? 'DEP/ARR' : 'DEP'}`}
            value={r.occupiedBy.length > 0 ? r.occupiedBy.join(', ') : 'Clear'}
            tone={r.occupiedBy.length > 0 ? 'warn' : 'ok'}
          />
        ))}
      </div>
      <div className="hud-controls">
        {/* On small screens only the icons show; aria-labels keep the buttons named. */}
        <button type="button" className="btn" disabled={!inGame} onClick={() => controller.togglePause()} title="Pause / resume (P)" aria-label={status === 'PAUSED' ? 'Resume' : 'Pause'}>
          {status === 'PAUSED' ? '▶' : '❚❚'}
          <span className="btn-text">{status === 'PAUSED' ? ' Resume' : ' Pause'}</span>
        </button>
        <div className="segmented" role="group" aria-label="Simulation speed">
          {SIM_CONFIG.timeScales.map((scale) => (
            <button
              type="button"
              key={scale}
              className={scale === timeScale ? 'active' : ''}
              disabled={!inGame}
              onClick={() => controller.setTimeScale(scale)}
            >
              {scale}×
            </button>
          ))}
        </div>
        <button type="button" className="btn" title="Fit the whole map on screen" aria-label="Fit map" onClick={() => controller.setCameraView('airport')}>
          ⤢<span className="btn-text"> Fit</span>
        </button>
        <button type="button" className="btn" disabled={!inGame} title="End the shift and see the mission summary" aria-label="End shift" onClick={() => controller.endShift()}>
          ■<span className="btn-text"> End shift</span>
        </button>
        <button type="button" className="btn" disabled={!inGame && status !== 'GAME_OVER'} title="Restart" aria-label="Restart" onClick={() => controller.restart()}>
          ↻<span className="btn-text"> Restart</span>
        </button>
      </div>
    </header>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
