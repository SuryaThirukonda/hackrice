# Tempo repository audit

Audit date: 2026-09-13  
Audited revision: `d0ddbfd44ede6ec136645297784e109706eee0c5` (`main`)  
Repository: `SuryaThirukonda/hackrice`  
Package: `tempo` 0.3.0

## 1. Executive summary

Tempo is a browser arcade and motion-fitness product built for HackRice 16. It combines three deterministic sports games—boxing, bowling, and golf—with keyboard play, phone motion controls, local two-player play, AI-versus-AI Fight Night, play-chip betting, activity history, optional webcam head tracking, optional camera vitals, and a prerecorded announcer.

The product is substantially implemented rather than a static prototype. The simulations, menus, input translation, 3D rendering, phone relay, local persistence, agent fallback, announcer, and most supporting services have automated coverage. At this revision:

- The strict TypeScript production build passes.
- All 37 Vitest files pass: 323 tests total.
- `npm audit` reports zero known vulnerabilities across 156 installed dependency entries.
- The optional Python head-tracker test is not runnable in the current environment because `cv2` is missing.
- The worktree was clean before this report was added.

The strongest engineering decision is the separation between deterministic simulations and presentation. Phaser owns scenes, input, HUD, and the fixed-step loops; PlayCanvas consumes snapshots and renders them. This keeps physics and scoring reproducible and makes visual replacement relatively safe.

The largest release blocker is access control. The automatically created public Cloudflare tunnel proxies the agent, controller, health, chips, and vitals APIs, but those endpoints have no authentication or pairing secret. A person who obtains the tunnel URL can inject controller traffic, consume the configured OpenAI quota, alter or erase local records, and start or stop the camera-vitals bridge. The health and camera claims are appropriate for a local demo only until this boundary is secured.

## 2. Product definition

Tempo is a comic-styled arcade sports collection designed to turn a phone into a motion controller while a laptop or projector runs the game. Its primary loop is:

1. Open the game on the host computer.
2. Choose one-player, two-player, or Fight Night.
3. Pick boxing, bowling, or golf.
4. Optionally connect one or two phones by QR code.
5. Play using keyboard input, phone movement, or both.
6. Record movement summaries and show session results locally.

The product currently exposes these top-level experiences:

| Experience | What it does | Implementation state |
|---|---|---|
| One player | Human versus a deterministic House bot in each sport | Implemented |
| Two players | Local head-to-head play; split-screen boxing and turn-based bowling/golf | Implemented |
| Fight Night | Two AI-controlled boxers fight while the room bets play chips | Implemented; works with OpenAI or scripted fallback |
| Phone controller | D-pad, action buttons, motion gestures, calibration, slot selection | Implemented |
| Health | Shows activity time, estimated calories, swings, sport totals, ROM trend, and recent effort | Implemented when the local service runs |
| Camera vitals lab | Reads pulse, breathing, and experimental HRV through SmartSpectra after UI consent | Implemented as an optional lab |
| Head tracker | Converts deliberate webcam head movements into boxing slips and ducks | Implemented as an optional Python process |
| Announcer | Prerecorded commentary, rules for interruption/priority, and captions | Implemented |
| Host a game | Projector/host/rail concept | Placeholder only |

## 3. Supported environments

### Host computer

The main game is a Vite browser application. It requires:

- A modern browser with WebGL 2. `Engine3D` explicitly asks PlayCanvas for `DEVICETYPE_WEBGL2`; there is no WebGL 1 or Canvas renderer fallback for the sports worlds.
- Keyboard and pointer input for the full host experience.
- Node.js for the development server and optional local service. The repository is currently verified with Node 24.20.0 and npm 11.19.0.
- A GPU/browser combination capable of running PlayCanvas. Low, medium, and high quality settings adjust pixel ratio, shadows, and post-processing.

The code is browser-oriented and has no Electron, native mobile, console, App Store, or packaged desktop target. There is no production hosting manifest, Docker image, CI workflow, or pinned Node `engines` field.

### Phone controller

The controller is a responsive React page intended for current iOS and Android browsers. Basic buttons and the D-pad can work over a same-LAN HTTP address. Motion gestures require a secure context, so normal motion-controller use requires HTTPS. The development server starts an anonymous Cloudflare quick tunnel and serves a QR code for this purpose.

The controller handles:

- DeviceMotion and DeviceOrientation permission flows.
- Calibration and screen-orientation normalization.
- Wake-lock and landscape-lock requests when the browser supports them.
- Reconnection with sequence numbers and event IDs.
- Controller slots 1 and 2.
- Sport-specific gestures and buttons.

Real device coverage is not automated in this repository. Browser differences, iOS permission behavior, motion sensor availability, and local-network policy still require physical-device testing.

### Optional webcam features

- Head tracking requires Python, MediaPipe, OpenCV, `websockets`, and an accessible webcam.
- Camera vitals require the `@smartspectra/node-sdk`, a Presage/SmartSpectra key, compatible native runtime support, and a camera visible to the Node process.
- The current machine lacks Python OpenCV, so the Python detector test did not execute.

## 4. Technology stack

| Layer | Technology | Responsibility |
|---|---|---|
| Application shell | Vite 8, TypeScript 5.9 | Development, build, module graph, multiple HTML entries |
| Menus and HUD | Phaser 3.90 | Scenes, text, buttons, overlays, input, transitions, timing |
| 3D | PlayCanvas 2.22 | Ring, alley, golf course, procedural models, lighting, particles, cameras |
| Phone/lab UI | React 19 | Join, controller, motion lab, vitals lab |
| Local service | Node HTTP + `ws` | AI calls, controller relay, health/chip persistence, vitals bridge |
| Persistence | `node:sqlite` | Sessions, movement epochs, swings, vitals, fights, bets, chip ledger |
| AI | OpenAI Responses API | Structured sport actions and between-round boxing strategy |
| Voice | Prerecorded ElevenLabs MP3 assets | Runtime announcer playback without a live voice dependency |
| Development tunnel | Cloudflare quick tunnel | Public HTTPS and WSS address for phones |
| Tests | Vitest 5; Python unittest-style script | Simulations, controllers, server, announcer, persistence, tracker logic |

TypeScript uses `strict`, `noUnusedLocals`, `noUnusedParameters`, `isolatedModules`, and `erasableSyntaxOnly`. This is a strong compile-time baseline. There is no configured linter, formatter, browser end-to-end runner, or coverage threshold.

## 5. Runtime architecture

```text
Host browser
  Phaser scene/UI canvas
    -> keyboard/pointer commands
    -> fixed-step sport simulation (120 Hz)
    -> snapshots + events
    -> HUD, announcer and health tracker
    -> PlayCanvas world.apply(...)
  PlayCanvas canvas
    -> one shared AppBase and camera
    -> current sport world

Phone browser(s)
  sensors/buttons
    -> /controller-ws
      -> Node ControllerRelay
        -> /controller-game-ws
          -> ControllerInput
            -> sport command mapper

Fight Night
  simulation summary
    -> AgentLink
      -> /agent/act or /agent/ws
        -> OpenAI structured tool call
        -> validated script
        -> deterministic fallback on failure

Local records
  game/phone summaries
    -> /health and /chips
      -> data/health.sqlite
```

### Core invariants

1. Simulation is authoritative. Renderers do not decide hits, scores, hazards, or bot actions.
2. All three sports advance at 120 Hz with fixed steps and clamp accumulated frame time to avoid an unlimited catch-up loop.
3. Seeds and command streams make game results reproducible.
4. Phaser owns UI and input; PlayCanvas owns 3D presentation.
5. The browser never receives OpenAI, SmartSpectra, or ElevenLabs credentials.
6. Phone inputs are normalized before game-specific mapping.
7. Optional services fail quietly so keyboard games remain playable when the Node service is offline.

## 6. Application entry points and scene flow

### HTML entries

| Entry | Purpose | Production build input |
|---|---|---|
| `index.html` | Main Phaser/PlayCanvas game | Yes |
| `controller.html` | React phone controller | Yes |
| `join.html` | Controller-slot join page | Yes |
| `motion.html` | Host-side motion diagnostic lab | Yes |
| `vitals.html` | Camera-vitals diagnostic lab | Yes |
| `environment-preview.html` | 3D environment review page | No |
| `announcer-review.html` | Announcer asset review page | No |

`src/main.ts` creates the Phaser game, connects the controller relay, registers scenes, and manages resize behavior. Development builds expose `window.__game`, `window.__advance`, `window.__pad`, and error capture for browser-driven checks.

The main scene progression is:

```text
Boot -> Title -> Main Menu
                  |-> Mode Select -> Game Select -> Pre-fight -> Sport
                  |-> Fight Night -> Boxing spectator match
                  |-> Connect Phone
                  |-> Health
                  |-> Tutorial / guided practice
                  |-> Settings
                  |-> Credits
                  `-> Host a Game placeholder
```

Phaser scene instances are reused, so the sport scenes explicitly clear per-match fields on restart. Each sport supplies a pause overlay, result flow, activity badge, tutorial hooks, controller input, and announcer integration.

## 7. Sports implementation

### Boxing

Boxing is a three-round, first-person bout with movement, guard, stamina, jabs, crosses, hit stun, guard breaks, dodges, knockdowns, referee counts, get-ups, KO/decision results, particles, camera kick, and hit stop.

Important rules from `src/games/boxing/sim/constants.ts`:

- 120 Hz simulation.
- Three 90-second rounds with 8-second rests.
- 100 HP and 100 stamina.
- Jab: 150 ms wind-up, 6 damage, 9 stamina.
- Cross: about 267 ms wind-up, 12 damage, 16 stamina.
- Dodges cost 4 stamina and reward 12 after a successful evade.
- Three knockdowns in a round trigger the round knockdown limit.
- Same-seed randomness controls bot timing and recovery behavior.

The four fixed single-player classes are:

| Class | Reaction ticks | Block | Dodge | Counter | Aggression | Visual |
|---|---:|---:|---:|---:|---:|---|
| Rookie | 50 | 0.22 | 0.06 | 0.05 | 0.17 | Beginner human boxer |
| Pro | 34 | 0.40 | 0.16 | 0.25 | 0.32 | Intermediate human boxer |
| Champ | 22 | 0.52 | 0.28 | 0.55 | 0.46 | Professional human boxer |
| Boss | 18 | 0.62 | 0.36 | 0.65 | 0.52 | Broad hoodie boxer with ginger beard |

The models are assembled procedurally in `OpponentRig` from PlayCanvas boxes and low-band faceted meshes. The common rig preserves head, body, hip, and two-bone arm IK pivots, so appearance changes do not alter hit detection or reach. Fight Night adds the human professional, mint alien, purple reptile, and steel robot variants.

Two-player boxing creates two first-person camera rigs and two arm rigs, assigns half-width camera viewports, and renders both fighter bodies into the appropriate camera layers.

### Bowling

Bowling models a full ten-frame game with regulation-style lane dimensions, a ten-pin rack, gutters, ball power, aim angle, lane position, hook, oil transition, pin-to-pin contact, strikes, spares, tenth-frame bonus balls, scoring, and bot turns.

The simulation uses a 120 Hz disc solver with four contact iterations. Human input includes a sweeping aim line, lock timing, charge/power, and hook. Phone input can arm a throw, lock the line, and use the detected swing strength. Two-player bowling alternates turns and controller slots.

The PlayCanvas scene builds the alley, physical ball and pins, lane materials, audience, aim guide, and lighting. Rendering interpolates simulation snapshots; it does not modify pin or ball state.

### Golf

Golf implements three themed three-hole courses:

| Course | Theme | Wind range |
|---|---|---|
| Meadow Links | Meadow | 0–6 m/s |
| Desert Canyon | Canyon | 1–7 m/s |
| Neon Night | Neon | 0–4 m/s |

Players choose driver, 3-wood, 5-iron, 7-iron, wedge, or putter. The shot simulation covers launch, wind, bounce, rolling, fairway, rough, green, bunker, water, out-of-bounds, cup capture, penalties, pickup, turn order, and score-to-par. Club speeds are solved at module initialization to match target carry distances.

The PlayCanvas course renderer generates terrain, greens, hazards, water, trees, theme props, ball trails, aim and flight cameras, and overhead course framing. Two-player golf alternates turns and controller slots.

## 8. Input and controller implementation

### Keyboard and pointer

Each sport has a typed key map, help labels, settings overrides, and key-map tests. Menus support arrows/WASD where appropriate, Enter/Space, Escape, and pointer interaction. Boxing reserves a separate set for player two and prevents player one's arrow controls from colliding with it.

### Phone motion pipeline

The phone samples acceleration and rotation, normalizes vectors to screen orientation, calibrates a rest baseline, and runs a sport-specific state machine:

- Boxing accepts an immediate punch and rejects the recoil as a second punch. Rotation selects jab versus cross and detected magnitude sets punch power.
- Bowling and golf use an armed window; the strongest valid swing becomes the throw or shot.
- Continuous D-pad data is latest-state-wins and expires after 250 ms on the host.
- Gestures and button events are queued exactly once using event IDs and sequence numbers.
- Activity epochs summarize one second of movement; raw 60 Hz samples are not persisted.

The relay supports `controller_1`, `controller_2`, and `head_tracker`. It rejects invalid controller IDs, duplicate occupied slots, controller changes, stale sequence numbers, duplicate event IDs, malformed vectors, unsupported actions, and oversized activity arrays.

## 9. AI and Fight Night

Fight Night runs two boxing bots from generated action scripts. The four selectable personas are:

| Persona | Style | Model |
|---|---|---|
| Knuckles McGraw | Forward-moving heavy-cross brawler | Human professional |
| The Professor | Patient defensive counter-puncher | Alien |
| Lucky Lou | Flashy, sway-heavy showboat | Reptile |
| Iron Maggie | Persistent jab-focused fighter | Robot |

`AgentLink` sends periodic summarized state, not direct mutable simulation objects. `AgentService` asks the OpenAI Responses API for one required structured tool call. Tool arguments are parsed and validated, boxing scripts are filtered against actual stamina, action count is capped, and timeouts fall back to deterministic scripts. Fast in-play requests have a 3-second default timeout and no reasoning; between-round strategy requests have an 8-second timeout and high reasoning.

If no `OPENAI_KEY` exists, if the configured model is unavailable, if a call times out, or if output validation fails, the match continues with scripted behavior. This makes Fight Night demonstrable offline, although it is then no longer LLM-directed.

## 10. Betting and persistence

Fight Night uses play chips only. The pure `Book` module starts at 500 chips, requires a 10-chip minimum stake, calculates fixed odds from visible HP/stamina/knockdown/round form with a 0.94 house margin, refunds draws, records payouts, and grants a bailout to 100 when the balance falls below 10 after markets close.

The browser-side `ChipLedger` mirrors completed decisions to the service. The in-memory book remains authoritative during a fight; the SQLite history supplies cross-reload balance and record summaries.

`data/health.sqlite` contains:

| Table | Contents |
|---|---|
| `sessions` | Sport, controller, source, timestamps, weight and computed activity summary |
| `epochs` | Per-second mean/peak acceleration, swing count and rotation |
| `swings` | Per-swing range-of-motion values |
| `vitals` | Timestamped pulse, breathing, HRV and confidence |
| `fights` | Fight participants, seed, result and chip summary |
| `bets` | Market, corner, stake, odds, outcome and payout |
| `chip_ledger` | Every chip grant, stake, payout, refund and bailout |

SQLite uses WAL mode. The database and `.env` are ignored by Git. Browser settings and a fallback chip record also use `localStorage`.

## 11. Health and vitals

The phone calculates one-second activity summaries. The host batches them into a match session and posts them to the local service. The health summary reports:

- Active seconds and qualifying active minutes.
- Estimated calories above resting expenditure.
- Swing count.
- Mean and peak range of motion.
- Mean intensity and peak acceleration.
- Fatigue trend.
- Daily streak, per-sport totals, recent session, and seven-day history.

The calorie figure uses a sport-specific MET range, body weight, active acceleration, and an additional per-swing estimate. It is correctly described in the UI and code as an estimate, not a medical measurement.

The vitals bridge lazily loads SmartSpectra, checks camera devices, applies a minimum confidence gate, and saves accepted readings. The lab offers a demo mode. The UI requires a consent checkbox before it starts a real camera session, but the server endpoint does not independently enforce consent or authenticate the caller.

Movement summaries and SQLite records stay on the host computer. SmartSpectra is an external service path: according to the repository documentation, it receives preprocessed camera signal data. Product privacy text should preserve this distinction.

## 12. Announcer

The announcer is an event-driven presentation layer rather than live text generation. Sport maps translate simulation events and frames into cue IDs. Speaking rules prioritize calls, prevent repetition, manage quiet-time color lines, interrupt lower-priority speech, and pause with the game. A shared variant picker rotates line variants across scenes.

Audio is generated ahead of time and committed under `public/announcer`; the runtime needs no ElevenLabs key. Missing or undecoded clips fall back to captions. The settings screen controls announcer enablement, volume, and captions. Practice mode is silent.

The announcer CLI supports dry runs, selective take generation, deterministic seeds, manifest updates, and a review page. The committed audio directory is about 6.7 MB and is the largest first-party static asset group.

## 13. 3D engine and visual implementation

`Engine3D` is a singleton PlayCanvas `AppBase` on a canvas beneath Phaser. It:

- Creates a WebGL 2 graphics device.
- Disables automatic rendering; each sport renders after applying its snapshot.
- Owns one shared camera and key/fill/rim lighting.
- Maintains per-sport world roots and environment atlases.
- Supports static/dynamic batch groups and optional lightmap baking.
- Applies gradient environment lighting, fog, tint, saturation, exposure, SSAO, bloom, outlines, and depth-of-field according to quality.
- Uses procedural geometry, generated textures, decals, billboards, particles, and water rather than a conventional imported-asset pipeline.

Quality behavior:

| Quality | Post-processing | Shadows | Pixel ratio / shadow map |
|---|---|---|---|
| Low | Disabled | Disabled | Pixel ratio 1 |
| Medium | Enabled without full high-end stack | Enabled | Up to device ratio 2, 1024 shadows |
| High | Full stack including SSAO | Enabled | Up to device ratio 2, 2048 shadows |

The procedural approach fits the low-poly comic style and avoids external model-loading failure modes. It also means geometry and material lifecycle must be managed explicitly.

## 14. Server and API surface

The optional service listens on port 8790 by default. Vite proxies it through the game origin.

### HTTP

| Method and route | Purpose |
|---|---|
| `GET /agent/health` | Verify configured model or report scripted fallback |
| `POST /agent/act` | Generate one structured sport action/strategy |
| `GET /health/summary?days=N` | Aggregated activity history |
| `GET /health/sessions?limit=N` | Finished session list |
| `POST /health/session` | Start activity session |
| `POST /health/session/:id/add` | Add epochs and ROM values |
| `POST /health/session/:id/finish` | Finalize session summary |
| `DELETE /health` | Delete movement and vitals history |
| `GET /chips/summary` | Balance and betting record |
| `GET /chips/ledger?limit=N` | Chip ledger |
| `POST /chips/fight` | Start fight record |
| `POST /chips/fight/:id/bet` | Record bet |
| `POST /chips/fight/:id/settle` | Settle market and append ledger |
| `POST /chips/fight/:id/finish` | Finish fight record |
| `DELETE /chips` | Reset balance to 500 through a grant entry |
| `GET /vitals` | Current vitals state |
| `GET /vitals/devices` | Camera inventory |
| `GET /vitals/history?minutes=N` | Recent accepted readings |
| `POST /vitals/start` | Start demo or real capture |
| `POST /vitals/stop` | Stop capture |

### WebSocket

| Route | Purpose |
|---|---|
| `/agent/ws` | Request/response agent channel |
| `/controller-ws` | Phone and head-tracker side of relay |
| `/controller-game-ws` | Host game side of relay |

Request JSON is limited to roughly 1 MB. Most numeric and string fields are clamped or sliced before storage. CORS currently allows any origin, and there is no authentication or authorization.

## 15. Repository map

| Path | Responsibility |
|---|---|
| `src/main.ts` | Main game bootstrap and scene registration |
| `src/scenes/` | Menus, mode/game selection, pre-fight, tutorial, settings, health, controller pairing, Fight Night |
| `src/games/*/sim/` | Deterministic sport state, bots, physics, scoring and typed events |
| `src/games/*/render/` | PlayCanvas worlds, interpolation, procedural geometry and rigs |
| `src/games/*/hud/` | Phaser HUDs and result/pause overlays |
| `src/engine3d/` | Shared PlayCanvas app, camera, primitives, materials, effects, post stack, environments and water |
| `src/input/` | Keyboard state, controller socket consumer, join-link resolution |
| `src/phone/` | React controller, join UI, socket, sensor processing and styling |
| `src/agent/` | Browser agent link, generated-script execution and difficulty mapping |
| `src/betting/` | Pure play-chip book and server mirroring |
| `src/health/` | Activity estimation, session client and live badge |
| `src/announcer/` | Cue catalogue, mappings, rules, segments, voice playback and review UI |
| `src/lab/` | Motion and vitals diagnostic React pages |
| `server/` | Node service, OpenAI adapter, relay, SQLite store and vitals bridge |
| `scripts/` | Tunnel, fake phone, head tracker and announcer generation |
| `test/` | Cross-layer smoke, controller, announcer CLI and Python tracker tests |
| `public/announcer/` | Committed MP3 takes and manifest |
| `legacy/2d/` | Archived Phaser-only renderer and migration notes |
| `docs/` | Existing spec, handoff, environment, next-phase and boxer documentation |

The repository currently has 244 tracked files, about 22,613 lines across first-party TS/TSX/MJS/Python/CSS source, 161 tracked `src` files, 13 server files, and 38 automated test files when the Python test is included. `src` is about 1.4 MB; the entire checked-out workspace is about 865 MB because installed dependencies and generated output are present locally.

## 16. Configuration and operation

### Commands

| Command | Function |
|---|---|
| `npm install` | Install JavaScript/native dependencies |
| `npm run dev` | Vite host on port 5174 plus automatic phone tunnel |
| `npm run agent` | Node AI, persistence, vitals and controller-relay service on port 8790 |
| `npm run build` | Strict TypeScript check and production Vite build |
| `npm test` | Run Vitest suite |
| `npm run test:head-tracker` | Run Python synthetic tracker checks |
| `npm run fake-phone` | Drive the real relay with synthetic phone motion |
| `npm run head-tracker` | Run webcam boxing head tracker |
| `npm run tunnel` | Start a standalone quick tunnel |
| `npm run announcer -- ...` | Audit/generate announcer takes |

### Environment variables

| Variable | Purpose |
|---|---|
| `OPENAI_KEY` or `OPENAI_API_KEY` | Fight Night LLM calls |
| `AGENT_MODEL` | Preferred model ID; default `gpt-5.6-luna` |
| `AGENT_PORT` | Local service port; default 8790 |
| `PRESSAGE_KEY`, `PRESAGE_KEY`, or `PRESAGE_API_KEY` | SmartSpectra camera vitals |
| `ELEVENLABS_KEY` | Offline announcer generation |
| `ELEVENLABS_ANNOUNCER_VOICE` | Announcer voice ID |
| `HAP_NO_TUNNEL=1` | Disable automatic public tunnel |

`.env.example` contains placeholders and `.env` is correctly ignored. The server reads keys; the client does not import them.

## 17. Verification performed

| Check | Result | Notes |
|---|---|---|
| `npm test` | Pass | 37 files, 323 tests |
| `npm run build` | Pass | TypeScript and Vite production build |
| `npm audit --json` | Pass | 0 known vulnerabilities across production and development dependencies |
| `npm audit --omit=dev --json` | Pass | 0 known production vulnerabilities |
| `npm run test:head-tracker` | Blocked | `ModuleNotFoundError: cv2` on this machine |
| Git ignored-file checks | Pass | `.env`, `data/`, `dist/`, and `node_modules/` ignored |
| Working tree before report | Clean | No unrelated edits detected |

Coverage is strongest in deterministic simulation behavior, scoring, key maps, controller normalization, motion detection, AI output validation/fallback, WebSocket relay rules, SQLite calculations, betting conservation, announcer rules, and smoke matches.

Coverage gaps:

- No automated real-browser end-to-end suite.
- No WebGL screenshot/regression suite in CI.
- No physical iOS/Android motion matrix.
- No accessibility audit.
- No load, soak, or repeated-match memory test.
- No authenticated-network tests because authentication is not implemented.
- No coverage thresholds or reports.
- Python dependencies are not installed or locked by this repository.

## 18. Audit findings

Severity definitions: Critical blocks safe release; High should be fixed before sharing beyond a trusted demo; Medium affects reliability, performance, or maintainability; Low is cleanup or future-proofing.

### High: public tunnel exposes privileged local APIs

The Vite quick tunnel is a public HTTPS origin. Its proxy forwards `/agent`, `/health`, `/chips`, `/vitals`, and both controller WebSockets. The Node service accepts requests from any origin and has no token, login, origin check, or pairing secret.

Impact:

- A caller with the URL can invoke the configured OpenAI model and consume quota.
- A caller can submit generated actions or connect as a controller/game socket.
- A caller can read or delete activity/vitals history.
- A caller can rewrite play-chip/fight records.
- A caller can start or stop the camera-vitals bridge without passing through the UI consent checkbox.

Recommended fix: generate a high-entropy session token when the host starts, include a short-lived pairing credential in controller QR links, require the host token for health/chips/vitals/agent routes, validate `Origin`, and bind the raw service to loopback. Treat camera start as a separately authorized host action.

### High: PlayCanvas worlds and GPU resources accumulate across matches

`Engine3D.newWorld()` pushes every created world into a persistent array. Sport shutdown calls `world.hide()`, which disables worlds but does not destroy their roots, materials, meshes, generated textures, batch groups, or environment-specific resources. Re-entering or restarting sports creates additional worlds.

Impact: long-running installations and repeated matches can accumulate CPU memory, GPU memory, scene entities, and batch state. Golf hole resources have some local destroy handlers, but the top-level sport world lifecycle is not closed.

Recommended fix: add `destroy()` to every sport world, destroy the root and owned resources, remove it from `Engine3D.worlds`, and make materials/textures either cached with reference ownership or explicitly disposed. Add a soak test that cycles through at least 50 matches and asserts stable entity/material/texture counts.

### Medium: boxing render springs can diverge on large frame deltas

The boxing scene clamps a slow frame to 100 ms, then passes up to `0.1` seconds into explicit-Euler springs with stiffness values as high as 140. This integrator can overshoot and eventually produce extremely large or non-finite transforms when a tab is throttled or rendering stalls. Golf clamps renderer delta to 50 ms; the shared spring implementation itself has no guard.

Recommended fix: clamp/substep spring integration to about 1/60 second, or replace it with an analytic critically damped update. Add tests that feed repeated 50–100 ms deltas and assert all spring positions and velocities remain finite.

### Medium: camera consent exists only in the browser UI

`VitalsLab` requires a checkbox, but `POST /vitals/start` trusts any caller. This compounds the public-tunnel issue and weakens the product's stated consent model.

Recommended fix: require a host-issued, one-use consent grant or make real-camera start available only on a loopback-only control channel. Persist an auditable consent state separately from `demo: true`.

### Medium: service lifecycle lacks graceful shutdown

`HealthStore` exposes `close()`, and the vitals bridge exposes stop behavior, but `server/agent.ts` has no SIGINT/SIGTERM shutdown that stops vitals, closes WebSockets/HTTP, and closes SQLite. The standalone tunnel does have signal cleanup.

Recommended fix: install idempotent shutdown handlers, stop camera processing first, close WebSocket servers and HTTP, close SQLite, and apply a short forced-exit deadline.

### Medium: production bundle is large and eager

The main production JavaScript bundle is approximately 2.83 MB minified and 759 KB gzip. Vite warns that it exceeds the 500 KB threshold. Phaser, PlayCanvas, all sport code, scenes, and support systems are largely eager in the main graph.

Impact: slower cold start, especially when the host is tethered or on lower-powered hardware.

Recommended fix: split sport scenes/renderers behind dynamic imports, isolate PlayCanvas, defer labs and optional paths, and inspect the bundle with a visualizer. Preserve prewarming after the user reaches game selection.

### Medium: no deployment security boundary or production topology

The repo has development and preview servers but no documented production reverse proxy, TLS termination, authentication layer, process manager, CSP, security headers, backup policy, or data-retention policy. `allowedHosts: true` and permissive CORS are appropriate for a hackathon tunnel, not an internet deployment.

Recommended fix: define a trusted local/demo topology and a separate production topology before deployment. Add explicit headers, origin policy, request rate limits, payload schemas, log redaction, and database backup/retention rules.

### Medium: Python feature dependencies are undocumented as an installable manifest

The README gives a `pip install` command, but there is no `requirements.txt`, `pyproject.toml`, lockfile, Python version range, or automated environment setup. The tracker test currently fails because OpenCV is absent.

Recommended fix: add a small locked Python project or requirements file with supported versions, make model download behavior explicit, and run the tracker test in CI on one supported Python version.

### Low: final activity packets can be missed during session close

`HealthTracker.end()` sets `ended = true` before calling `pump(Infinity)`. `pump()` immediately returns when `ended` is true, so controller activity that arrived after the previous frame pump is not drained during finalization. Existing pending data is still flushed, so this is a narrow end-of-session loss.

Recommended fix: drain once before flipping `ended`, or split the drain operation from the public guarded `pump()` method. Add a test for an activity packet arriving immediately before `end()`.

### Low: SQLite foreign-key declarations are not enabled

Tables declare cascading foreign keys, but the store enables WAL only and does not run `PRAGMA foreign_keys = ON`. SQLite does not enforce those relationships by default.

Recommended fix: enable foreign keys on connection and add rejection/cascade tests. Confirm existing databases contain no orphaned bets, epochs, swings, or ledger rows before relying on enforcement.

### Low: build and documentation drift

- Vite warns that `__dirname` in `vite.config.ts` will not work with its planned native config loader default; use `import.meta.dirname`.
- Existing `docs/SPEC.md` identifies an older commit and reports 254 tests/16,071 source lines, while this audit measured 323 tests/22,613 lines.
- The root contains a tracked three-byte `bub.txt`, which appears to be a stray artifact.
- The repository has no CI definition, license file, lint command, formatting policy, CODEOWNERS, issue template, or contribution guide.

Recommended fix: remove or explain the stray file, refresh generated metrics, add a lightweight CI workflow for build/tests/audit, and document ownership and licensing.

## 19. Strengths

- Deterministic, typed simulations are cleanly separated from rendering.
- Fixed-step state and event contracts are extensively tested.
- Phone events use sequence numbers, freshness limits, and exactly-once IDs.
- AI output is tool-constrained, validated, stamina-limited, time-bounded, and safely falls back.
- Betting conservation and SQLite summaries have direct tests.
- Secrets stay server-side and sensitive local files are ignored.
- Optional services fail without breaking core keyboard gameplay.
- Health copy distinguishes estimates from medical measurements.
- Prerecorded announcer assets eliminate runtime TTS latency and API dependency.
- Low/medium/high rendering controls make the product usable across a wider range of host hardware.
- Procedural visuals give the project a coherent art style and avoid a fragile asset pipeline.

## 20. Recommended implementation order

### Before any public demo URL is shared broadly

1. Add per-session authentication/pairing to every HTTP and WebSocket route.
2. Make real camera start a host-local consent action.
3. Bind the service to loopback and let Vite be the only network-facing process.
4. Add basic rate limits to agent and write endpoints.

### Before a long-running installation

1. Implement and test PlayCanvas world/resource disposal.
2. Stabilize spring integration for slow frames.
3. Add graceful Node service shutdown.
4. Run a repeated-match memory/GPU soak test.

### Before a production release

1. Define deployment topology, CSP/security headers, data retention, privacy language, and backup behavior.
2. Add CI for TypeScript build, Vitest, dependency audit, and Python tests.
3. Add browser end-to-end smoke tests and physical phone coverage.
4. Split the main bundle and measure cold-start performance.
5. Add a Python dependency manifest and supported platform matrix.
6. Refresh existing documentation and remove unexplained artifacts.

## 21. Product readiness assessment

| Area | Status | Assessment |
|---|---|---|
| Core gameplay | Green | Three playable, deterministic sports with bots and two-player support |
| Visual presentation | Green | Complete comic HUD plus procedural PlayCanvas worlds |
| Phone controls | Yellow-green | Strong implementation and unit tests; physical device matrix still needed |
| Fight Night | Green for demo | LLM and deterministic fallback both supported |
| Health tracking | Green for local demo | Useful local summaries; end-of-session edge case exists |
| Camera vitals | Yellow | Optional lab works by design, but consent and network boundary need hardening |
| Security | Red for public deployment | Public tunnel exposes unauthenticated privileged routes |
| Long-session stability | Yellow | World/resource lifecycle and slow-frame springs need fixes |
| Build/test health | Green | Build and 323 JS/TS tests pass; Python environment missing |
| Deployment readiness | Yellow-red | No production topology, CI, auth, or operational policy |

Tempo is ready for a controlled local hackathon demonstration where the tunnel URL is treated as temporary and trusted. It is not ready to be deployed as a public multi-user service until access control, camera authorization, resource disposal, and production operations are addressed.

