# Airport Traffic Control Simulator 3D

Browser-based 3D airport traffic control game (React + TypeScript + Three.js / React Three Fiber).
The full specification is in [SPEC.md](SPEC.md).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run typecheck  # app + test/tooling configs
npm run build
```

Browser smoke test (Playwright) on desktop, Android (Pixel 7), iPad and iPhone 14 — the Apple
devices run on WebKit, Safari's engine. The first run needs the browsers once:

```bash
npx playwright install chromium webkit
npm run test:e2e   # starts the dev server itself, or reuses one on port 5173
```

## Devices

The layout adapts to the screen:

| Screen | Layout |
|---|---|
| Desktop (≥1100 px) | Flight list, map and aircraft panel side by side |
| Tablet (768–1099 px) | Flight list in a drawer (**✈ Flights**), aircraft panel on the right |
| Phone, portrait (<768 px) | Full-screen map; flight list drawer; aircraft panel slides up when a flight is selected |
| Phone, landscape | Full-screen map; aircraft panel slides in from the right |

On touch screens: drag to pan, pinch to zoom, tap an aircraft or its label to select it.
Notches and home indicators are respected, and the game can be added to the home screen on iOS and Android.

## How to play

You control a two-runway airport: departures take off from **01R** (east); arrivals land on **01L** (west) or **01R**, your choice. 01R is shared by landings and takeoffs, one aircraft on the runway at a time.
After a landing clearance an arrival leaves the hold and flies the arrival route: south along the west side, east below the airport, then north onto final.
Select an aircraft in the flight list or on the map, then use the command panel.

| Flight | Commands, in order |
|---|---|
| Arrival | **LAND** on **RWY 01L** or **RWY 01R** (bottom of the holding stack only) → **TAXI** to a free gate. **GO AROUND** while landing aborts the approach and rejoins the hold. |
| Departure | **PUSHBACK** → **TAXI** to a holding point (several may queue) → **LINE UP** → **TAKEOFF** |
| Taxiing | **HOLD** / **CONTINUE** (key `H`) to resolve head-on traffic |

Keys: `P` pause, `Esc` deselect, `H` hold/continue. **End shift** shows the mission summary.

### Scoring

| Event | Points |
|---|---|
| Arrival parked at its gate | +100 |
| Departure handed off | +100 |
| Diversion (180 s in the hold without landing clearance) | −50 |
| Runway incursion | −100 |
| Traffic conflict / lost separation (per pair) | −25 |
| Go-around | −20 |
| Delay: each full minute a flight waits on the ground for an instruction | −10 |
| Collision | Game over |

All values live in `src/sim/config.ts`.

## Structure

- `src/sim/` — the whole simulation in plain TypeScript (no React/Three): fixed-step clock, airport layout and taxiway graph, path geometry (filleted polylines, Dubins curves), aircraft state machine, movement, AI, commands, safety, collisions and scoring. Testable in Node.
- `src/game/` — `GameController` bridging the simulation to React via a throttled Zustand store; dev-only `window.__sim` debug hook.
- `src/scene/` — Three.js scene: procedural airport, aircraft models, route overlays, camera.
- `src/ui/` — HUD, flight list, command panel, alerts, overlays and the mission summary.
- `e2e/` — Playwright smoke test.

## Milestones

- [x] 1. Vertical slice: one airport, one arrival, smooth navigation, selection, LAND and TAXI commands
- [x] 2. Departures: pushback, taxi to holding point, line up, takeoff
- [x] 3. Spawning multiple flights, difficulty curve, diversions
- [x] 4. Safety: separation warnings, runway incursions, collisions, GAME_OVER, departure queuing
- [x] 5. GO_AROUND, scoring penalties, mission summary, Playwright smoke test, dev tooling upgrade

Simplified game rules — not a real or certified air traffic control system.
