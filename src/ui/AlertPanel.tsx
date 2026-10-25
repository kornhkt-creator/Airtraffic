import { useGame, useGameStore } from '../game/GameContext';
import { formatClock } from './format';

const ICON = { info: 'ℹ', success: '✔', warning: '⚠', critical: '⛔' } as const;

/** Safety warnings, clearances and rejected-command feedback (newest first). */
export function AlertPanel() {
  const controller = useGame();
  const alerts = useGameStore((s) => s.snapshot.alerts);
  if (alerts.length === 0) return null;
  return (
    <div className="alerts" aria-live="polite">
      {alerts.map((a) => (
        <button
          type="button"
          key={a.id}
          className={`alert ${a.severity}`}
          onClick={() => a.aircraftId && controller.select(a.aircraftId)}
        >
          <span className="alert-icon">{ICON[a.severity]}</span>
          <span className="alert-time">{formatClock(a.time)}</span>
          <span className="alert-msg">{a.message}</span>
        </button>
      ))}
    </div>
  );
}
