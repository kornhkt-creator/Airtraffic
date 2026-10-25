# MASTER PROMPT: AIRPORT TRAFFIC CONTROL SIMULATOR 3D

## ROLE

You are a senior game developer, Three.js specialist, React architect, TypeScript engineer, and simulation systems designer.

Build a playable browser-based 3D airport traffic control simulation inspired by the general gameplay genre of Airport Madness 3D. Create original assets, UI, game logic, and branding. Do not copy proprietary game assets or source code.

## PRODUCT OBJECTIVE

Build an MVP called **Airport Traffic Control Simulator 3D**. The player acts as an air traffic controller and manages AI aircraft that arrive, land, taxi to gates, push back, taxi to the runway, and take off.

The application must be a functioning game, not just a static 3D scene or UI prototype. It must create pressure on the player (traffic volume, waiting limits, increasing difficulty) so that decisions matter.

UI language: English (keep all UI strings in one module so a Thai translation can be added later).

## TECHNOLOGY STACK

- React 18 + React Three Fiber v8 + @react-three/drei v9 (compatible set), **or** React 19 + React Three Fiber v9 + @react-three/drei v10. Pick one set and keep all versions mutually compatible.
- TypeScript with `strict: true`
- Vite
- Three.js
- Zustand for shared UI and game state where appropriate
- Vitest for unit tests
- Playwright for browser-level smoke tests

Development environment is Windows (PowerShell). npm scripts must work cross-platform.

## NON-GOALS (MVP)

Do not build any of the following in the MVP:

- Multiple runways or crossing runways
- Weather, wind, day/night cycle
- Realistic flight physics or aerodynamics
- Real ATC phraseology, voice, or radio audio
- Multiplayer, accounts, backend, or online leaderboards
- Mobile/touch support (desktop browser is the target)

## UNITS AND DEFAULT VALUES

All internal simulation values use **meters, meters/second, seconds, and radians**. The UI may display knots and feet.

All values below live in a single typed config module and must be easy to tune.

| Parameter | Default |
|---|---|
| Runway length / width | 2000 m / 45 m |
| Approach speed | ~70 m/s |
| Touchdown speed | ~65 m/s |
| Rollout deceleration | ~3 m/s² |
| Taxi speed (max) | ~10 m/s |
| Takeoff rotation speed | ~75 m/s |
| Takeoff acceleration | ~2.5 m/s² |
| Air separation WARNING | < 1500 m horizontal AND < 300 m vertical |
| Air COLLISION | < 60 m horizontal AND < 30 m vertical |
| Ground separation WARNING | < 80 m |
| Ground COLLISION | < 25 m (center-to-center, or bounding radius sum) |
| Arrival spawn interval | 45–90 s at start, shrinking over time |
| Departure spawn interval | 60–120 s at start, shrinking over time |
| Max approach holding time | 180 s, then the flight diverts (penalty) |
| Delay penalty threshold | waiting > 60 s at a gate or holding point |
| Simulation boundary radius | ~12 km from the airport origin |

Use a **seeded random number generator** for spawns and any randomness so runs and tests are reproducible.

## CORE FEATURES

### 1. 3D AIRPORT

Build an original low-poly or moderately detailed airport scene containing:

- One primary runway with threshold, centerline, and touchdown markings
- Connected taxiways with holding points (hold-short lines) before the runway
- At least two runway exits
- Terminal building, control tower, and at least 4 gates / parking stands
- Taxiway markings and signage
- Directional lighting and shadows
- A controllable camera (orbit, pan, zoom with sensible limits; a reset-view button)

The airport must have:

- A documented coordinate system (origin, axis directions, units)
- A **taxiway graph** of nodes and directed or undirected edges describing every valid ground route (gates, taxiway nodes, holding points, runway entry/exit points)

Use procedural geometry or original placeholder assets when external 3D models are unavailable.

### 2. AIRCRAFT AI

Implement multiple independently controlled aircraft. Each aircraft must have:

- Unique ID and callsign
- Flight type: ARRIVAL or DEPARTURE
- Position, heading, speed, and altitude
- Current status and assigned route
- Waypoint navigation along valid paths
- Smooth turns and speed changes (no instant heading or speed jumps)
- Approach, landing, ground movement, pushback, and takeoff behavior
- A timer for how long it has been waiting (used for diversion and delay penalties)

#### States

```
APPROACH, LANDING, GO_AROUND, LANDED, TAXIING, HOLDING, AT_GATE,
PUSHBACK, LINE_UP, TAKEOFF, DEPARTED, DIVERTED, CRASHED
```

#### Lifecycles

```
Arrival:   APPROACH → LANDING → LANDED → TAXIING → AT_GATE           (completed on reaching the gate)
           LANDING → GO_AROUND → APPROACH                           (missed approach)
           APPROACH → DIVERTED                                      (waited too long; penalty)

Departure: AT_GATE → PUSHBACK → TAXIING → HOLDING → LINE_UP → TAKEOFF → DEPARTED
                                                                    (completed when leaving the sim boundary)

Any state → CRASHED (only through a confirmed collision)
```

- Use a **state machine with an explicit table of allowed transitions**. Invalid transitions must be rejected, never silently applied.
- An APPROACH aircraft without a landing clearance flies a holding pattern and keeps its waiting timer running.
- Aircraft must not teleport between waypoints or move through invalid taxiway connections.
- A TAXIING aircraft must stop at a holding point before entering the runway unless it has a LINE_UP clearance.
- An aircraft on the ground must slow down or stop when another aircraft is directly ahead on its path (simple follow logic), but this is a safety aid, not a replacement for the player's decisions.

#### Simulation clock

- The simulation runs at a **fixed timestep** (e.g. 20 Hz) using an accumulator pattern, in plain TypeScript, independent of React.
- Simulation behavior must not depend on the rendered frame rate.
- Support a time-scale control: **pause, 1x, 2x, 4x**.

### 3. COMMAND SYSTEM

Allow the player to select an aircraft by clicking its 3D model or its flight entry in the list. Show the selected aircraft with a highlight in the 3D scene.

Display:

- Callsign and flight type
- Status
- Speed and altitude
- Current target or route
- Waiting time
- Available commands (commands that are not valid in the current state are disabled with a reason on hover)

Implement these commands:

| Command | Valid from | Effect |
|---|---|---|
| `LAND` | APPROACH | Clears the aircraft to land on the runway |
| `GO_AROUND` | LANDING (before touchdown) | Aborts landing, climbs, returns to APPROACH |
| `TAXI` | LANDED, AT_GATE (after pushback), HOLDING | Assigns a route to the chosen destination |
| `HOLD` | TAXIING | Stops the aircraft where it is |
| `RESUME` | TAXIING (held) | Continues the current route |
| `PUSHBACK` | AT_GATE (departure) | Pushes the aircraft back onto the taxiway |
| `LINE_UP` | HOLDING | Enters the runway and waits in position |
| `TAKEOFF` | LINE_UP | Begins the takeoff roll |

TAXI routing:

- The player picks a **destination** (a gate for arrivals, a holding point for departures), not each node.
- The RouteManager computes the shortest valid route on the taxiway graph (A* or Dijkstra).
- If no valid route exists, the command is rejected.

Validation:

- Commands must validate aircraft state, runway occupancy, route availability, and safety constraints before execution.
- Invalid commands must be rejected with a clear, specific explanation (e.g. "Runway occupied by ABC123").
- The player is still allowed to issue risky but legal commands (e.g. landing when traffic is close behind); the safety system then warns, and a collision can still happen. This is what makes the game a game.
- Never change only the UI label without changing actual simulation behavior.

### 4. SAFETY AND COLLISION SYSTEM

Implement a dedicated safety engine independent of the rendering layer. Include:

- Runway occupancy tracking (which aircraft occupy or are cleared onto the runway)
- Runway conflict detection (e.g. landing clearance while another aircraft is lined up or taking off)
- Runway incursion detection (aircraft passing a holding point without clearance)
- Aircraft separation warnings (air and ground)
- Ground collision detection
- Air collision detection using horizontal distance and altitude
- Command validation and rejection
- Visible safety alerts (in the alert panel and as a marker/color on the aircraft in 3D)

Rules:

- Use the configurable thresholds from the config module and consistent units.
- Separate warnings from actual collision events. A warning alone must not end the game.
- A confirmed collision must transition both aircraft to CRASHED and the game into GAME_OVER **exactly once**.
- Use conservative, clearly documented simplified simulation rules. Do not represent the game as a certified or operational air traffic control system.

### 5. SCORING AND GAME FLOW

Game states: `MENU → RUNNING ⇄ PAUSED → GAME_OVER → (restart) → RUNNING`

Implement:

- Start game
- Pause and resume
- Real-time simulation with time-scale control
- Increasing difficulty over time (shorter spawn intervals, more simultaneous flights)
- Successful flight tracking
- Score for safely completed flights
- Configurable penalties for: diversions, delays over the threshold, runway incursions, rejected-unsafe situations, and go-arounds (small penalty)
- Game-over screen with mission summary
- Restart with a fully reset game state (clock, RNG seed, aircraft, score, alerts, selection)

Prevent duplicate scoring or duplicate penalties for the same event or flight.

### 6. USER INTERFACE

Create a polished, modern simulation interface.

Layout:

- **Top HUD:** score, elapsed time, active flights, time-scale control, pause button
- **Left panel:** aircraft list with callsign, type, status, and waiting time
- **Center:** interactive 3D airport
- **Right panel:** selected aircraft details and command buttons
- **Alert area:** safety warnings and invalid-command feedback (newest first, auto-expire non-critical messages)
- **End screen:** score, completed flights, diversions, incidents, and restart button

Use clear status labels and colors, readable typography, and responsive panels. Keyboard shortcuts are a bonus (e.g. Space = pause, L = land, T = taxi).

## ARCHITECTURE

Keep the following systems modular:

- `AirportScene`
- `AircraftModel`
- `AircraftStateMachine`
- `AircraftAI`
- `MovementSystem`
- `RouteManager` (taxiway graph + pathfinding)
- `SpawnSystem`
- `GameLoop`
- `SimulationClock`
- `SafetySystem`
- `CollisionSystem`
- `ScoringSystem`
- `CommandSystem`
- `GameStore`
- `AircraftPanel`
- `CommandPanel`
- `AlertPanel`
- `ScorePanel`

Rules:

- Keep simulation logic in plain TypeScript, separate from React rendering and UI components. The simulation must be runnable and testable in Node without a browser.
- 3D meshes read aircraft positions through refs inside `useFrame`. Do **not** push per-frame positions into React state.
- Push UI-relevant snapshots to Zustand at a throttled rate (about 5–10 Hz).
- Use TypeScript types for all core domain objects. Avoid `any`, unsafe global state, monolithic components, and duplicated game logic.
- In development and test builds only, expose `window.__sim` with read access to state and a way to issue commands, so Playwright tests do not depend on clicking WebGL pixels.

## DEVELOPMENT PROCESS

1. Inspect the existing repository before modifying files.
2. If the folder is not a git repository, run `git init`. Commit after each verified milestone.
3. If the repository is empty, scaffold the project using Vite, React, and TypeScript.
4. Establish the airport coordinate system, runway geometry, taxiway graph, config module, and aircraft data types.
5. Build a playable vertical slice with one aircraft before implementing multiple flights.
6. Add aircraft navigation, pathfinding, and state transitions.
7. Add command handling and runway occupancy validation.
8. Add spawning of multiple arrivals and departures.
9. Implement safety detection and collision events.
10. Add scoring, difficulty progression, game-over, restart, and UI polish.
11. Add automated tests for state transitions, command validation, pathfinding, runway conflicts, collision detection, scoring (including no duplicates), and reset behavior.
12. Run the tests, type checks, and production build.
13. Fix actual errors before declaring the implementation complete.

### Milestone verification

After each milestone:

1. Run `typecheck`, `test`, and `build`.
2. Run the app in a browser and take a screenshot to confirm it renders and behaves as intended.
3. Report what works, what does not, and any limitation.
4. Commit.

Work incrementally. Do not replace working code unnecessarily. Do not create fake buttons or mock successful gameplay. If an asset or feature cannot be completed, explain the limitation and provide a working fallback.

## ACCEPTANCE REQUIREMENTS

The MVP is complete only when:

- The application runs in a browser.
- A 3D airport is visible and interactive.
- Multiple arrivals and departures move through complete lifecycles.
- The player can issue LAND, GO_AROUND, TAXI, HOLD, PUSHBACK, LINE_UP, and TAKEOFF commands.
- Commands affect actual aircraft behavior.
- Taxi routes follow the taxiway graph only.
- Unsafe operations are detected, warned, and handled.
- A collision causes GAME_OVER exactly once.
- Difficulty increases over time.
- Score tracking, penalties, and restart work correctly.
- Critical simulation logic has automated tests that pass.
- At least one Playwright smoke test passes (app loads, game starts, a command changes an aircraft's state).
- `typecheck` and the production build succeed.

## FIRST TASK

Inspect the repository and report:

1. Existing project structure and relevant dependencies.
2. Missing components required for the MVP.
3. Proposed implementation order and chosen package versions.

**Stop and wait for approval before implementing.**

After approval, implement the first playable vertical slice: one airport with its taxiway graph, one controllable arrival aircraft, smooth waypoint navigation, aircraft selection, and a working command panel (LAND and TAXI to a gate). Verify it using the milestone verification steps before proceeding to the next milestone.
