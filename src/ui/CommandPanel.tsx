import { useGame, useGameStore } from '../game/GameContext';
import type { CommandOption } from '../sim/CommandSystem';
import type { AircraftView } from '../sim/snapshot';
import { SIM_CONFIG } from '../sim/config';
import { formatClock, STATUS_LABEL, statusClass } from './format';

/** Right panel: selected aircraft details and the commands that can be issued to it. */
export function CommandPanel() {
  const selected = useGameStore((s) => s.snapshot.aircraft.find((a) => a.id === s.selectedId) ?? null);

  return (
    <aside className="panel right-panel">
      <h2 className="panel-title">Aircraft</h2>
      {selected ? <Details aircraft={selected} /> : <p className="muted">Select an aircraft in the list or click it on the map.</p>}
    </aside>
  );
}

function Details({ aircraft: a }: { aircraft: AircraftView }) {
  return (
    <div className="details">
      <div className="details-head">
        <span className="callsign big">{a.callsign}</span>
        <span className={statusClass(a.status)}>{STATUS_LABEL[a.status]}</span>
      </div>
      <dl className="readout">
        <div>
          <dt>Type</dt>
          <dd>{a.flightType === 'ARRIVAL' ? 'Arrival' : 'Departure'}</dd>
        </div>
        <div>
          <dt>Speed</dt>
          <dd>{a.speedKt} kt</dd>
        </div>
        <div>
          <dt>Altitude</dt>
          <dd>{a.altitudeFt} ft</dd>
        </div>
        <div>
          <dt>Heading</dt>
          <dd>{String(a.headingDeg).padStart(3, '0')}°</dd>
        </div>
        <div>
          <dt>Waiting</dt>
          <dd>{formatClock(a.waitTime)}</dd>
        </div>
        {a.holdingLevel !== null && (
          <div>
            <dt>Stack level</dt>
            <dd>{a.holdingLevel + 1}</dd>
          </div>
        )}
        {a.divertIn !== null && (
          <div className={a.divertIn <= SIM_CONFIG.air.divertWarning ? 'fuel-low' : ''}>
            <dt>Diverts in</dt>
            <dd>{formatClock(a.divertIn)}</dd>
          </div>
        )}
      </dl>
      <div className="target">
        <span className="stat-label">Current instruction</span>
        <span>{a.target}</span>
      </div>
      <h3 className="section-title">Commands</h3>
      <div className="commands">
        {a.commands.map((c) => (
          <CommandControl key={c.type} aircraftId={a.id} option={c} />
        ))}
      </div>
    </div>
  );
}

function CommandControl({ aircraftId, option }: { aircraftId: string; option: CommandOption }) {
  const controller = useGame();

  if (option.destinations) {
    // TAXI picks a gate or holding point, LAND picks a runway.
    const issue = (id: string) =>
      option.type === 'TAXI'
        ? controller.command({ type: 'TAXI', aircraftId, destinationId: id })
        : option.type === 'LAND'
          ? controller.command({ type: 'LAND', aircraftId, runwayId: id })
          : undefined;
    const verb = option.type === 'LAND' ? 'Land on' : 'Taxi to';
    return (
      <div className={`command-group ${option.enabled ? '' : 'disabled'}`}>
        <div className="command-label" title={option.reason}>
          {option.type} — {option.label}
        </div>
        {!option.enabled && option.reason && <div className="reason">{option.reason}</div>}
        <div className={`dest-grid ${option.type === 'LAND' ? 'runway-grid' : ''}`}>
          {option.destinations.map((d) => (
            <button
              type="button"
              key={d.id}
              className={`btn cmd ${option.type === 'LAND' ? 'primary' : ''}`}
              disabled={!d.enabled}
              title={d.reason ?? `${verb} ${d.label}`}
              onClick={() => issue(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const type = option.type;
  if (type === 'TAXI') return null; // TAXI always comes with destinations
  return (
    <div className={`command-group ${option.enabled ? '' : 'disabled'}`}>
      <button
        type="button"
        className="btn cmd primary"
        disabled={!option.enabled}
        title={option.reason ?? option.label}
        onClick={() => controller.command({ type, aircraftId })}
      >
        {type.replace('_', ' ')} — {option.label}
      </button>
      {!option.enabled && option.reason && <div className="reason">{option.reason}</div>}
    </div>
  );
}
