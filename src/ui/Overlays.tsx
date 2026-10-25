import { useGame, useGameStore } from '../game/GameContext';

export function StartScreen() {
  const controller = useGame();
  const status = useGameStore((s) => s.snapshot.status);
  if (status !== 'MENU') return null;
  return (
    <div className="overlay">
      <div className="modal">
        <h1>Airport Traffic Control Simulator 3D</h1>
        <p className="lead">You are the controller at Northfield Regional. Bring arrivals down safely and park them at a gate.</p>
        <ol className="howto">
          <li>Select an aircraft from the list or click it in the 3D view.</li>
          <li>
            Issue <b>LAND</b> when the runway is clear. The aircraft leaves the holding pattern and flies the approach.
          </li>
          <li>
            After touchdown, issue <b>TAXI</b> and pick a free gate.
          </li>
        </ol>
        <p className="muted small">Camera: left-drag to orbit, right-drag to pan, wheel to zoom. P pauses, Esc deselects.</p>
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
