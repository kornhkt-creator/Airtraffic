import { useGame, useGameStore } from '../game/GameContext';
import { SIM_CONFIG } from '../sim/config';
import { formatClock } from './format';
import type { CameraView } from '../scene/cameraPresets';

const CAMERA_VIEWS: { view: CameraView; label: string; title: string }[] = [
  { view: 'airport', label: 'Airport', title: 'Camera on the airport' },
  { view: 'airspace', label: 'Airspace', title: 'Camera on the holding stack and approach' },
];

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
  const runway = useGameStore((s) => s.snapshot.runwayOccupiedBy);
  const cameraView = useGameStore((s) => s.cameraView);
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
        <Stat label="RWY 09/27" value={runway.length > 0 ? runway.join(', ') : 'Clear'} tone={runway.length > 0 ? 'warn' : 'ok'} />
      </div>
      <div className="hud-controls">
        <button type="button" className="btn" disabled={!inGame} onClick={() => controller.togglePause()} title="Pause / resume (P)">
          {status === 'PAUSED' ? '▶ Resume' : '❚❚ Pause'}
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
        <div className="segmented" role="group" aria-label="Camera view">
          {CAMERA_VIEWS.map(({ view, label, title }) => (
            <button type="button" key={view} className={view === cameraView ? 'active' : ''} title={title} onClick={() => controller.setCameraView(view)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn" disabled={!inGame} onClick={() => controller.restart()}>
          ↻ Restart
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
