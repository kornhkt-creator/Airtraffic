# Airport Traffic Control Simulator 3D

Browser-based 3D airport traffic control game (React + TypeScript + Three.js / React Three Fiber).
The full specification is in [SPEC.md](SPEC.md).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run typecheck
npm run build
```

## Structure

- `src/sim/` — the whole simulation in plain TypeScript (no React/Three): fixed-step clock, airport layout and taxiway graph, path geometry (filleted polylines, Dubins curves), aircraft state machine, movement, AI, commands, safety and scoring. Testable in Node.
- `src/game/` — `GameController` bridging the simulation to React via a throttled Zustand store; dev-only `window.__sim` debug hook.
- `src/scene/` — Three.js scene: procedural airport, aircraft models, route overlays, camera.
- `src/ui/` — HUD, flight list, command panel, alerts, overlays.

## Milestones

- [x] 1. Vertical slice: one airport, one arrival, smooth navigation, selection, LAND and TAXI commands
- [x] 2. Departures: pushback, taxi to holding point, line up, takeoff
- [x] 3. Spawning multiple flights, difficulty curve, diversions
- [ ] 4. Safety: separation warnings, runway incursions, collisions, GAME_OVER
- [ ] 5. Scoring penalties, end screen, polish, Playwright smoke test

Simplified game rules — not a real or certified air traffic control system.
