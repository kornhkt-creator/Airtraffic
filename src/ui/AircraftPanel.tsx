import { useGame, useGameStore } from '../game/GameContext';
import { SIM_CONFIG } from '../sim/config';
import { formatClock, STATUS_LABEL, statusClass } from './format';

/** Left panel: every flight with its status. Clicking selects it. */
export function AircraftPanel() {
  const controller = useGame();
  const aircraft = useGameStore((s) => s.snapshot.aircraft);
  const selectedId = useGameStore((s) => s.selectedId);

  return (
    <aside className="panel left-panel">
      <h2 className="panel-title">Flights</h2>
      {aircraft.length === 0 && <p className="muted">No traffic yet.</p>}
      <ul className="flight-list">
        {aircraft.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              className={`flight-row ${a.id === selectedId ? 'selected' : ''}`}
              onClick={() => controller.select(a.id === selectedId ? null : a.id)}
            >
              <span className="flight-main">
                <span className="callsign">{a.callsign}</span>
                <span className={`type-tag ${a.flightType === 'ARRIVAL' ? 'arr' : 'dep'}`}>{a.flightType === 'ARRIVAL' ? 'ARR' : 'DEP'}</span>
              </span>
              <span className="flight-sub">
                <span className={statusClass(a.status)}>{STATUS_LABEL[a.status]}</span>
                {a.divertIn !== null ? (
                  <span className={`wait fuel ${a.divertIn <= SIM_CONFIG.air.divertWarning ? 'low' : ''}`} title="Time until this flight diverts">
                    ⛽ {formatClock(a.divertIn)}
                  </span>
                ) : (
                  a.waitTime >= 1 && <span className="wait">⏱ {formatClock(a.waitTime)}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
