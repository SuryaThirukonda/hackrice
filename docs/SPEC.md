# Tempo — repository spec sheet and PlayCanvas guide

Accurate as of commit `d612677` (2026-09-13). Everything below was read from the code, not from memory.
Where a number appears, it is the value in the file named next to it.

This document has three jobs:

1. **Spec sheet.** Every directory, file, export and contract in the repository, so a new contributor can find
   and change anything without a tour (parts 1 to 12).
2. **PlayCanvas guide.** How this project embeds and drives the PlayCanvas engine, the in-house toolkit built on
   top of it, and the rules that keep the 3D layer fast and correct (parts 13 and 14).
3. **New boxer looks.** A concrete recipe for adding different, more detailed cartoon boxers so the player can
   fight different people (part 15). This is the reason the document was written.

`docs/HANDOFF.md` is the narrative handoff (what was decided, what is open). `docs/ENVIRONMENT_LAYER.md` covers
the static venue scenery. `README.md` is the run sheet. This file is the reference.

---

## 1. Snapshot

| Item | Value |
|---|---|
| Name / version | `tempo` 0.3.0 (`package.json`), HackRice 16 browser arcade |
| Language | TypeScript 5.9, `strict`, `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `isolatedModules`, `jsx: react-jsx` |
| Build | Vite 8 (`npm run dev` on :5174, `npm run build` = `tsc --noEmit && vite build`, `npm run preview`) |
| UI / 2D | Phaser 3.90.0 (menus, HUDs, all text, all input) |
| 3D | PlayCanvas 2.22.2, engine-only (no editor, no asset pipeline) |
| Phone pages | React 19 (only `controller.html`, `join.html`, `motion.html`, `vitals.html`) |
| Server | Node 24, `tsx server/agent.ts` on :8790, `ws`, `node:sqlite` (`DatabaseSync`) |
| Tests | vitest 5, 26 test files, 245 tests, `npm test` (about 4 s) |
| Source size | 16 071 lines of TS/TSX/MJS across `src`, `server`, `scripts` |
| Optional services | OpenAI (`OPENAI_KEY`), Presage SmartSpectra (`PRESSAGE_KEY`), ElevenLabs (`ELEVENLABS_KEY`, unused so far) |

Line counts per area (TS/TSX/MJS/CSS): `src/phone` 4358, `src/games/boxing` 2602, `src/games/golf` 2324,
`src/games/bowling` 1920, `server` 1541, `src/scenes` 1053, `src/engine3d` 803, `src/lab` 660, `src/input` 465,
`src/health` 404, `scripts` 268, `src/ui` 224, `src/betting` 202, `src/agent` 199, `src/fx` 127.

---

## 2. Hard rules (architecture invariants)

These hold everywhere. Break one and something already written stops being true.

1. **Sims are the authority.** Each sport has a deterministic fixed-step simulation (boxing 120 Hz, bowling and golf
   their own steppers) that reads only `Command` values and a seeded `Rng`. Renderers and HUDs consume
   `Snapshot`s and `SimEvent`s. No render code writes sim state. Same seed and same commands give the same
   event log (`BoxingScene.getEventLog()` exists for that comparison).
2. **Phaser owns input, time and text.** PlayCanvas never draws UI. Phaser's `update()` steps the sim through an
   accumulator, interpolates two snapshots, then calls `world.apply(view, dt, ...)`, which ends in
   `engine.renderFrame()`. PlayCanvas `autoRender` is off.
3. **One PlayCanvas app, one camera, many worlds.** `Engine3D` is a singleton behind the Phaser canvas. Each sport
   builds a world entity (`engine.newWorld(name)`) and re-parents the single camera into its own rig. Whatever a
   sport hangs on the camera must be removed on `hide()` (see `PlayerArms.detach()`).
4. **Materials are shared, never per-part.** `flatMat()` allocates a new `StandardMaterial` every call. A rig
   creates its material set once and reuses it (the `M` object in `OpponentRig`).
5. **Segment children are rotationally symmetric.** `orientSegment()` rewrites a segment's position, rotation and
   scale each frame and leaves roll about the bone free. Anything parented to an IK segment must be a sphere or a
   cylinder, never a box.
6. **Skeleton names and offsets in `OpponentRig` are fixed.** `poses.ts` drives `root → lean (y 0.95) → body
   (y −0.95)`, `headPivot` at `body (0, 1.62, 0)`, shoulders `ARM_SH_L (−0.30, 1.43, 0)` / `ARM_SH_R (0.30, 1.43, 0)`,
   arm bones `ARM_L1 0.36`, `ARM_L2 0.34`, feet at `y = 0`, root faces `−Z` at the opponent.
7. **Secrets stay on the server.** `.env` keys are read by `server/agent.ts` only. The browser talks to `/agent`,
   `/health`, `/vitals`, `/chips` through the Vite proxy. `data/` (SQLite), `public/join-config.json` and `.env`
   are git-ignored.
8. **The tunnel is a quick tunnel.** Anonymous Cloudflare quick tunnels: no account, random hostname per run, no
   expiry, no SLA. `HAP_NO_TUNNEL=1` disables it.
9. **Bot tier tests pin floors.** Boxing rookie punches per minute > 4 and champ < 36; bowling champ average > 150
   with sway < 0.25; golf champ scores lower than rookie. Retune inside those bands or update the tests
   deliberately.

---

## 3. Repository map

### Root

| Path | Purpose |
|---|---|
| `index.html` | Game entry. `#game` div, PlayCanvas canvas (`canvas.pc`) sits at `z-index:0`, Phaser canvas at `z-index:1`, cursor hidden. Loads `src/main.ts`. |
| `controller.html`, `join.html`, `motion.html`, `vitals.html` | React phone controller, join page, motion lab, vitals lab (entries in `vite.config.ts` `build.rollupOptions.input`). |
| `environment-preview.html` | Dev-only static 3D review page (`?sport=boxing|bowling|golf`), loads `src/dev/environmentPreview.ts`. Not part of the production build. |
| `vite.config.ts` | React plugin + `cloudflareTunnel()` plugin; `PROXY` map to :8790 (`/agent` ws, `^/health(/|$)`, `^/vitals(/|$)`, `^/chips(/|$)`, `/controller-ws`, `/controller-game-ws`); `allowedHosts: true`; same proxy for `preview`. |
| `vitest.config.ts` | `src/**/*.test.ts`, `server/**/*.test.ts`, `test/**/*.test.ts`, node environment. |
| `tsconfig.json` | See section 1. Includes `src`, `server`, `test`. |
| `package.json` | Scripts: `dev`, `build`, `preview`, `test`, `test:watch`, `agent`, `typecheck`, `tunnel`, `fake-phone`. |
| `README.md` | Run sheet: phone controller, health, camera vitals, testing the controller, controls, architecture, 3D renderer, verification. |
| `docs/` | `HANDOFF.md`, `NEXT_PHASE.md`, `ENVIRONMENT_LAYER.md`, this file. |
| `.env` | `OPENAI_KEY`, `PRESSAGE_KEY` (double S; the loader also accepts `PRESAGE_KEY` and `PRESAGE_API_KEY`), `ELEVENLABS_KEY`. Values may have a space before `=`. |
| `data/health.sqlite` | Created by the agent service on first run (`mkdirSync('data')`). |

### `scripts/`

| File | Exports / behaviour |
|---|---|
| `quickTunnel.mjs` | `startQuickTunnel({ port, onOrigin, onError, quiet })` spawns `cloudflared tunnel --url http://localhost:<port> --no-autoupdate` (binary vendored by the `cloudflared` npm package) and scrapes the `https://*.trycloudflare.com` origin from stderr; `lanOrigin(port)` picks the first non-internal IPv4. |
| `tunnel.mjs` | `npm run tunnel`: standalone tunnel that writes `public/join-config.json` `{ origin, lan, port }` and deletes it on exit. |
| `tunnelPlugin.mjs` | `cloudflareTunnel()` Vite plugin: `configureServer` and `configurePreviewServer` start the tunnel and serve `/join-config.json` from middleware. |
| `fakePhone.ts` | `npm run fake-phone -- --slot 2 --sport golf --peak 22 --every 2500`: a Node phone that runs the real `MotionProcessor` and `ActivityTracker`, connects over the relay and sends `motion`, `gesture`, `stick`, `action` (`block_start` then `block_end` 700 ms later) and `activity` packets. |

### `server/`

| File | Exports | Role |
|---|---|---|
| `agent.ts` | (entry) | HTTP + WebSocket service on `AGENT_PORT` (default 8790). Routes in section 12. Friendly `EADDRINUSE` message. Creates `data/`. |
| `controllerRelay.ts` | `ControllerRelay` (`handles(pathname)`, `upgrade(req, socket, head)`) | Phone ↔ game relay on `/controller-ws` (phones) and `/controller-game-ws` (the game). Two slots `controller_1`, `controller_2`. Stamps the active sport on packets, replays the roster to a game that connects late, forwards `activity` packets (≤120 epochs / roms each), sends `game_state` (sport, blocking, telemetry flag). |
| `service.ts` | `AgentService`, `ActRequest`, `ActResponse`, `LlmClient`, `ServiceOptions` | The LLM corner: takes a sport summary + persona, calls OpenAI with a function tool, times out (`low`/`high` effort budgets), falls back to scripts. |
| `tools.ts` | `Sport`, `BoxAction`, `BOX_ACTIONS`, `BoxStep`, `BoxScript`, `BowlShot`, `GolfShot`, `AgentOutput`, `STRATEGY_TOOL`, `TOOLS`, `INTERVAL_MS = 2500`, `TAUNT_MAX = 60`, `SCRIPT_BUDGET = 0.6`, `RECOVER_BELOW = 15`, `MAX_PUNCHES = 3`, `affordable(steps, stamina)`, `parseOutput(sport, raw, tool, stamina)` | Tool schemas and output validation. `BoxAction` has no `out` (bots never retreat). |
| `summarize.ts` | `BoxingSummary`, `BowlingSummary`, `GolfSummary`, `Summary`, `instructions(sport, persona)`, `render(sport, summary)` | System prompt and the text rendering of a sim summary. |
| `fallback.ts` | `fallback(sport, summary, seedTick, strategy)` | Scripted output when the LLM is missing, slow or invalid (boxing default: block on at 0 ms, duck at 600, block off at 1800). |
| `health.ts` | `HealthStore`, `SessionStart`, `SessionRow`, `DaySummary`, `HealthSummary`, `ChipSummary`, `SessionSource` | SQLite store: sessions, epochs, swings, vitals, fights, bets, chip ledger (schema in section 12). |
| `vitals.ts` | `VitalsBridge`, `VitalsState`, `VitalsStatus`, `Reading`, `HrvReading`, `DecodedMetrics`, `MIN_CONFIDENCE = 60`, `listCameras()`, `emptyVitals()`, `toMs()`, `applyMetrics()`, `demoMetrics()` | Presage SmartSpectra Node SDK bridge (lazy import, refuses to start with no `/dev/video*`, demo mode). |
| `*.test.ts` | | `controllerRelay`, `service`, `health`, `vitals` tests. |

### `src/` top level

| File | Exports | Role |
|---|---|---|
| `main.ts` | (entry) | Phaser game config (`type: AUTO`, `transparent: true`, `Scale.RESIZE`, `fps.forceSetTimeOut` in dev), scene list, resize re-layout (`onResize()` or restart), dev hooks `window.__game`, `__pad`, `__advance(ms)`, `__errs`. Calls `controllerInput.connect()` first. |
| `theme.ts` | `P` palette, `HEX(n)`, `FONT`, `DISPLAY`, `ACCENTS`, `GameDef`, `GAMES` | Comic palette: `sky1 6fd6ff`, `sky2 1f8ff0`, `plum 1b2a6b`, `magenta ff2e88`, `pink ff7ad9`, `cyan 2ad4ff`, `teal 22c6a5`, `gold ffd50a`, `orange ff8c1a`, `lime 9dff3a`, `purple 7c5cff`, `ink 141414`, `paper fff1cf`, `red ff3a3a`, `blue 2f6cf6`, `green 35d06b`. |

### `src/scenes/` (Phaser scene key in parentheses)

| File | Key | What it does |
|---|---|---|
| `BootScene.ts` | `boot` | Texture generation, jumps to title. |
| `TitleScene.ts` | `title` | Title card. |
| `MainMenuScene.ts` | `menu` | PLAY, FIGHT NIGHT, HOST A GAME (placeholder), CONNECT A PHONE, HEALTH, HOW TO PLAY, SETTINGS, CREDITS. `goalCard()` shows today's kcal against the daily goal (`/health/summary`). Rows at `H*0.13 + i*76`, button height 70. |
| `ModeSelectScene.ts` | `mode` | 1P vs Fight Night (`card` goes straight to `fightnight`). |
| `GameSelectScene.ts` | `games` | Picks from `GAMES`; boxing/bowling/golf go to `prefight`. |
| `PreFightScene.ts` | `prefight` | Difficulty preset (`rookie`/`pro`/`champ`/`custom` sliders) and seed; golf also picks a course. Starts the sport with `{ mode, tier, bot: boxingParams(diff) | bowlingParams | golfParams, seed, course? }`. |
| `TutorialScene.ts` | `tutorial` | Pages from each sport's `tutorial.ts`; boxing has a guided practice. |
| `SettingsScene.ts` | `settings` | SOUND, 3D QUALITY (`low`/`medium`/`high`, applied live with `Engine3D.peek()?.setQuality`), key bindings per sport, reset. |
| `ControllerScene.ts` | `controller` | Phone connect screen: resolves the join link, draws a QR (dynamic `import('qrcode')`), shows FREE/CONNECTED per slot, LAN fallback warning. `openControllerConnect(scene)` pauses the caller and launches it (used by the pause overlay). |
| `HealthScene.ts` | `health` | Today, 7-day strip, per-sport totals, ROM trend, last-session effort curve, goal bar; weight and goal editing; `C` twice clears (`DELETE /health`), `R` refreshes, auto-refresh every 5 s. |
| `FightNightScene.ts` | `fightnight` | `PERSONAS` (Knuckles McGraw / red, The Professor / blue, Lucky Lou / gold, Iron Maggie / green), chips and record in `localStorage` (`hap.v2.chips`, `hap.v2.record`) reconciled with `/chips/summary`. Starts `boxing` with `{ mode: 'card', personas, seed }`. |
| `PlaceholderScene.ts` | `placeholder` | Title + subtitle card. |

### `src/ui/`, `src/fx/`

| File | Exports |
|---|---|
| `ui/widgets.ts` | `ensureTextures`, `ComicBackdrop`, `actionBurst`, `doodles`, `ComicButton` (+`ComicButtonOpts`), `comicPanel(scene, x, y, w, h, color, tilt, alpha)`, `MenuNav` |
| `ui/pauseOverlay.ts` | `pauseOverlay(scene, rows, actions, title)`, `PauseRow`, `PauseAction` (includes the CONNECT PHONE action) |
| `fx/transitions.ts` | `wipeTo(scene, key, data)`, `isWiping()` |
| `fx/sfx.ts` | `sfx` singleton (WebAudio, `enabled`, `unlock()`, cues: `hover`, `select`, `back`, `stamp`, `wipe`, `sparkle`, `whoosh`, `thud`, `block`, `dodge`, `parry`, `stagger`, `gassed`, `bell`, `countdown`, `knockdown`, `count`, `ko`, `win`, `crowd`) |
| `fx/CursorTrail.ts` | `CursorTrail` scene (`cursor`), always on top |

### `src/input/`

| File | Exports |
|---|---|
| `keys.ts` | `KeyState` (`attach(window)`, edge and held queries, `endFrame()`) |
| `controller.ts` | `controllerInput` singleton of `ControllerInput`: `setSport()`, `getSport()`, `stick(id)`, `drain(id, sport)`, `drainActivity(id)`, `clear(id?)`, `connect()`, `disconnect()`, `ingest(packet)`, `connected(id)`, `linked()`; types `ControllerSport`, `ControllerId`, `ControllerStick`, `ControllerGesture`, `ControllerButton`, `ControllerEvent`, `ActivityEpoch`; `phonePunchKind(gesture)` → `'jab' | 'cross'` |
| `joinLink.ts` | `JoinSource`, `JoinLink`, `NO_LINK`, `supportsMotion(link)`, `controllerUrl(link, player)`, `resolveJoinLink(fetch)` (page origin → `/join-config.json` tunnel → LAN → none) |

### `src/phone/` (React, phone side)

| File | Role |
|---|---|
| `controller-main.tsx`, `Controller.tsx`, `controller.css`, `play.css` | The controller page. D-pad (`Arrow` glyphs), power button (`Power`/`Busy`), face A (boxing: hold to block, `Shield`; other sports: start motion, `Play`), face B (boxing: duck `Duck`; bowling: arm the throw; golf: cancel / toggle aim, `Cancel`). Touch hardening in `play.css` (`user-select: none`, transparent tap highlight). Green `punch-ring` flash on a registered swing. |
| `Glyphs.tsx` | `Arrow`, `Pip`, `Shield`, `Play`, `Duck`, `Cancel`, `Power`, `Busy` (SVG, no text on buttons). |
| `ControllerSocket.ts` | `ControllerSocket` with `connect()`, `disconnect()`, `setSensorHz(hz)`, `getMetrics()`, `sendActivity(epochs, roms)`, `sendMotion(motion)`, `sendStick(stick)`, `sendGesture(gesture)`, `sendAction(action, sport)`; `hello` and `ping` are sent internally; `onTelemetry` option; types `ControllerAction`, `ControllerConnectionState`, `RttMetrics`, `ControllerSocketOptions`. |
| `motionProcessor.ts` | `MotionProcessor` (filtering, calibration, swing/punch detection, direction, power), `classifyDirection`, `orientVectorToScreen`; `FORWARD_RESET_MS = 300` clears the opponent direction after stillness so punches count in any direction. |
| `motion.ts` | `DeviceMotionSource`, `hasDeviceMotion()`, `enterPlayMode()` (permission + fullscreen). |
| `tiltStick.ts` | `TiltStickProcessor`, `screenTilt(beta, gamma, angle)`. |
| `config.ts` | `CONTROLLER_CONFIG` (filter, sensor fallback, calibration, stick, per-sport `DetectorConfig`, `ui.activityReportMs = 5000`). Golf `powerAccelerationMax 52`, `powerRotationMax 950`, `powerCurveExponent 1.5`; bowling `48 / 820 / 1.5`. |
| `actions.ts` | `EMERGENCY_POWER_MULTIPLIER = 1.1`, `applyEmergencyPower(gesture)`. |
| `Join.tsx`, `join-main.tsx`, `join.css`, `QR.tsx` | Join page with QR. |
| `fakeMotion.ts`, `sample.ts` | Synthetic motion for desktop testing. |

### `src/lab/`

| File | Role |
|---|---|
| `MotionLab.tsx`, `motion-main.tsx`, `Trace.tsx`, `lab.css` | Motion lab (`motion.html`): live traces, trigger line, guard indicator, punch flash, action log. |
| `VitalsLab.tsx`, `vitals-main.tsx` | Vitals lab (`vitals.html`): consent gate, device check (`/vitals/devices`), start/stop (`/vitals/start`, `/vitals/stop`), demo mode, history. |

### `src/health/`

| File | Exports |
|---|---|
| `energy.ts` | `HealthSport`, `Epoch`, `MET_BAND` (boxing `[3,6]`, bowling/golf `[2.5,3.5]`), `REST_MET 1`, `ACTIVE_MEAN 0.8`, `HARD_MEAN 6`, `ACTIVE_SECONDS_PER_MINUTE 20`, `DEFAULT_WEIGHT_KG 70`, `SWING_KCAL 1`, `DEFAULT_GOAL_KCAL 100`, `intensityIndex`, `metFor`, `kcalPerMinute` (`MET × 3.5 × kg / 200`), `summarize(sport, epochs, roms, weightKg)`, `formatActive(seconds)` → `m:ss`, `praise(kcal, swings, activeSeconds, goalKcal)` |
| `activity.ts` | `ActivityTracker` (`push(t, accelMag, rotMag, intervalMs)`, `noteSwing(t, durationMs)`, `drain()`, `flush()`) — runs on the phone and in `fakePhone.ts` |
| `tracker.ts` | `HealthTracker(sport)` (`pump()`, `live()`, `end()`), `summaryLine(line)`, `SessionSummaryLine` — game side, posts `/health/session`, `/health/session/:id/add`, `/health/session/:id/finish` |
| `liveBadge.ts` | `healthBadge(scene, tracker, x, y)` — the in-match kcal / active-time badge |

### `src/betting/`, `src/agent/`

| File | Exports |
|---|---|
| `betting/book.ts` | `Book` (markets, `openMarket`, `place`, `settle`, `closeMarkets`, `won/lost/net/balance`), `START_CHIPS 500`, `BAILOUT_BELOW 10`, `BAILOUT_TO 100`, `MARGIN 0.94`, `MIN_STAKE 10`, `Form`, `pA(form)`, `oddsFor(form)`, `Corner`, `MarketKind`, `Market`, `Bet`, `LedgerEntry` |
| `betting/ledger.ts` | `ChipLedger` (`begin(book, names, seed)`, `placed`, `settled`, `finish`), `fetchChipSummary()`, `resetChips()`, `startingChips(server, local)`, `ledgerSince(book, synced, now)`, `ChipSummary` |
| `agent/AgentLink.ts` | `AgentLink(personas)`: two `CornerAgent`s, `strategize(match)`, `tick(match, now)`, `noteEvents(events)`, `onTaunt`; talks to `/agent/act` |
| `agent/executor.ts` | `ScriptExecutor` (`command(tick)`, `isLate(tick)`): turns a `BoxScript` into per-tick `Command`s |
| `agent/sliders.ts` | `Difficulty`, `Preset`, `PRESETS`, `SLIDER_KEYS`, `boxingParams(d)`, `bowlingParams(d)`, `golfParams(d)`, `Quality`, `GameSettings` (`preset, difficulty, seed, sound, quality, bindings, weightKg 70, dailyGoalKcal 100`), `DEFAULT_SETTINGS`, `loadSettings()`, `saveSettings()`, `randomSeed()` |

### `src/engine3d/` — see part 13.

### `src/games/boxing/` — see part 7. `src/games/bowling/`, `src/games/golf/` — see part 8.

### `src/dev/environmentPreview.ts`

Dev-only entry (guarded by `import.meta.env.DEV`): creates `Engine3D`, builds the chosen world (`BoxingWorld(engine, undefined, true)` for boxing, i.e. spectator mode with both rigs), parks the camera, and renders on `requestAnimationFrame`. The fastest way to look at a boxer model without playing a match: `http://localhost:5174/environment-preview.html?sport=boxing`.

---

## 4. Runtime topology

```
phone (https://<random>.trycloudflare.com/controller.html)      big screen (http://localhost:5174/)
   │  wss /controller-ws                                             │  ws /controller-game-ws, fetch /health /chips /agent /vitals
   ▼                                                                 ▼
cloudflared quick tunnel ──► Vite dev server :5174 ──proxy──► agent service :8790 (tsx server/agent.ts)
                              (game, phone pages, labs)         ├─ ControllerRelay (slots, sport stamping, activity)
                                                                ├─ AgentService (OpenAI tools + fallback scripts)
                                                                ├─ HealthStore  (data/health.sqlite)
                                                                └─ VitalsBridge (Presage SDK, camera)
```

- `npm run dev` starts Vite and the tunnel plugin; `npm run agent` starts the service. Both are needed for a full
  session; the game runs without the service (no phones, no health, no LLM corners).
- `vite preview` serves `dist/` with the same proxy, so a production build still reaches the relay.
- The relay refuses a second phone on a taken slot (`controller_in_use`). `npm run fake-phone -- --slot 2` is the
  way to test while a real phone holds slot 1.
- For route checks while the owner's service is running, start a second one with `AGENT_PORT=8791`.

---

## 5. Boot and scene flow

`main.ts` waits for a settled window size (`whenSized`), then builds the Phaser game with these scenes in order:
`boot, title, menu, mode, games, placeholder, boxing, tutorial, prefight, settings, fightnight, bowling, golf,
controller, health, cursor`. Transitions go through `wipeTo(scene, key, data)`; a scene's `init(data)` receives the
object. Resize: scenes that implement `onResize()` re-lay out, others restart with their data.

Flow: `menu → mode → games → prefight → boxing|bowling|golf` (1P) and `menu → fightnight → boxing (card)`.
`tutorial` is reachable from the menu, the pre-fight screen and every pause overlay. `controller` (phone connect)
opens from the menu or from the pause overlay through `openControllerConnect(scene)`.

Settings persist in `localStorage` under the key used by `sliders.ts`; the 3D quality default comes from
`defaultQuality()` and can be changed live.

---

## 6. The game-loop contract

Every sport scene follows the same shape (boxing shown, `BoxingScene.update`):

1. Build the keyboard `Command` from `KeyState` and the sport keymap.
2. Build the phone command from `controllerInput.stick()` and `controllerInput.drain()`; merge field by field with
   the keyboard first (either source works at any moment).
3. Accumulate `deltaMs` (clamped to 100 ms); while `acc >= STEP_MS` (8.333 ms): `prev = curr`, `match.step(cmd)`,
   `curr = match.snapshot()`, dispatch `match.events` to `onEvent()` (sound, HUD cards, world fx, camera shake,
   hitstop). One-shot fields (punch, dodge) are applied on the first step of a frame only (`heldOnly()` after).
4. `hitStop` (ms) freezes the accumulator for impact frames.
5. `view = lerpView(prev, curr, acc / STEP_MS)`; `world.apply(view, dt, playerDown)`; `hud.update(view, dt)`.

`Snapshot`s are plain data: `{ tick, phase, round, clock, count, dir, dist, a: FighterView, b: FighterView }`.
`lerpFighter` interpolates position, head offset and progress only when the state and punch match.

Fight Night (`mode: 'card'`) replaces the human command with two `ScriptExecutor`s fed by `AgentLink`; a late
script (`isLate(tick)`) yields `null`, and the match lets the built-in `Bot` (`TIERS.pro`) drive that corner.

---

## 7. Boxing, in full

### 7.1 Sim (`src/games/boxing/sim/`)

**Types (`types.ts`).** `PunchKind = 'jab' | 'cross'`; `DodgeKind = 'swayL' | 'swayR' | 'duck'`; `Side = 'a' | 'b'`;
`Command { punch, punchPower?, dodge, block, forward: -1|0|1, strafe: -1|0|1 }` with `IDLE` and `cmd()`;
`FighterState = idle | windup | active | recover | dodge | hitstun | stagger | down | getup`; `Fighter` (position,
`vMove`, `vKnock`, `headOffset/headTarget`, `hp`, `stamina`, state timers `stateT/stateTotal/fresh`, `guard`,
`guardBroken`, `punch`, `punchPower`, `punchId`, `resolved`, `momentum`, `dodgeKind`, `dodgeCd`, `marks`, knockdown
and stat counters, `moving`); `SimEvent` union (`windup`, `punch` with result `hit|blocked|dodged|whiff`, `dodge`,
`stagger`, `guard_break`, `knockdown`, `count`, `getup`, `bell`, `countdown`, `ko`, `gassed`, `decision`);
`BotParams`; `MatchConfig { seed, rounds?, roundS?, restS?, botA?, botB? }`; `FighterView`; `Snapshot`; `MatchResult`.

**Constants (`constants.ts`).**

| Group | Values |
|---|---|
| Time | `HZ 120`, `DT`, `ticks(s)` |
| Ring | `RING_HALF 3.0`, `BODY_GAP 0.9`, `EYE_H 1.65`, `START_DIST 1.9` |
| Movement | `MOVE_FWD 1.6`, `MOVE_BACK 1.2`, `MOVE_STRAFE 1.3`, `GUARD_MOVE_MUL 0.6`, `PUNCH_CARRY 0.6`, `FRICTION 6` |
| Frames | jab `{ windup 12, active 6, recover 24, reach 1.2, dmg 6, stamina 9, blockCost 4, knock 0.9, hitstun 10 }`; cross `{ 24, 8, 40, 1.3, 12, 16, 8, 1.8, 18 }`; `CANCEL_WINDOW 6` |
| Damage | `MOMENTUM_DMG 0.5`, `MOMENTUM_KNOCK 0.6`, `STAGGER_BONUS 1.25`, `BLOCK_DMG_MUL 0.15`, `BLOCK_KNOCK_MUL 0.35`, `GUARD_BREAK_STAGGER 60`, `GUARD_RECOVER_STAMINA 15`, `STAGGER_DMG 11`, `STAGGER_TICKS 42` |
| Dodge | `DODGE_TICKS 30`, `DODGE_IFRAMES 22`, `DODGE_COOLDOWN 54`, `DODGE_STAMINA 4`, `DODGE_REWARD 12`, `SWAY_SLIDE 1.0`, `HEAD_SWAY 0.35`, `HEAD_DUCK 0.35`, `HEAD_LERP 0.25` |
| Stamina | `STAMINA_MAX 100`, `REGEN_IDLE 40` per second, `REGEN_GUARD_MUL 0.5`, `FATIGUE_KNEE 30`, `GETUP_STAMINA 40`, `REST_STAMINA 45` |
| Rounds | `ROUNDS 3`, `ROUND_S 90`, `REST_S 8`, `COUNTDOWN_STEP 1 s`, `COUNT_TICKS 1 s`, `GETUP_COUNT 8`, `KD_MARKS [60, 30]`, `KD_LIMIT_ROUND 3`, `GETUP_TICKS 30`, `HP_MAX 100` |
| Feel | `HITSTOP { jab 0, cross 4 }`, `HITSTOP_STAGGER 8`, `SHAKE { jab 0.25, cross 0.6 }` |

**Tick order (`match.ts` `step(cmdA, cmdB)`).** Reset `events`/`flags`; `tick++`; if not `fighting` run
`stepPhase()` + `physicsOnly()` and return. Otherwise: commands (human or `Bot.decide`) → `resolveBackSteps`
(when both want to back up, the one with less stamina is denied) → `applyCommand` for both (punch start, dodge,
guard, movement) → `advanceState` (windup → active → recover → idle; whiff event on an unresolved active) →
`tryResolve` each attacker against a `DefSnap` of the defender taken before either moved → `integrate` →
`separate`, `clampRopes`, `separate` → `facing` → `stamina` (refill in every state except windup/active/recover/
down/getup; half rate with the guard up; `guardBroken` clears at `GUARD_RECOVER_STAMINA`) → knockdown check →
round clock. Public surface: `a`, `b`, `rng`, `rounds`, `phase`, `round`, `tick`, `dir`, `events`, `flags`,
`seedValue`, `over`, `getResult()`, `fighter(side)`, `distance()`, `snapshot()`.

**Punch resolution (`punch.ts`).** `startPunch(f, kind, dir, out, power)` (stamina gate, `punchPower` 0..1 from
the phone, `punchDamageMultiplier(power) = 0.35 + 0.65 × power`), `resolvePunch(att, def, snap, dir, out)`
(dodge i-frames → `dodged` and `+DODGE_REWARD` stamina; guard → `blocked`, block cost, possible `guard_break`;
otherwise damage with momentum and fatigue multipliers, hitstun or stagger, knockback).

**Physics (`physics.ts`).** `dist`, `facing`, `rightOf`, `integrate` (friction 6), `pinned`, `separate` (keeps
`BODY_GAP`), `clampRopes` (`RING_HALF`).

**Fighter helpers (`fighter.ts`).** `createFighter`, `setState`, `fatigueTime` / `fatigueDmg` (below
`FATIGUE_KNEE` punches slow to 1.6× and weaken to 0.6×), `BUSY` set, `canMove`, `isDodgingIframes`.

**Bot (`bot.ts`).** Modes `approach | engage | react` (no retreat). On a fresh opponent windup it rolls dodge
(`dodgeP`, duck only against a cross with `duckP`) or block (`blockP`) and schedules the reaction at
`reactionTicks ± reactionJitter`, never later than the punch lands. In `engage` it runs combos from `patterns`
with `comboGap` ticks between punches, steps in on a cross with `stepInP`, rests `comboRest` ticks after a combo,
otherwise plans with `aggression`, holds a block, or circles with `circleP`. `counterP` is the chance of a cross
counter right after the bot's own dodge (`this.dodged`).

**Tiers (`tiers.ts`).**

| Tier | reaction ± jitter | blockP | dodgeP | duckP | counterP | aggression | comboGap | circleP | stepInP | comboRest |
|---|---|---|---|---|---|---|---|---|---|---|
| rookie | 50 ± 10 | 0.22 | 0.06 | 0.20 | 0.05 | 0.17 | 42 | 0.10 | 0.30 | 240 |
| pro | 34 ± 8 | 0.40 | 0.16 | 0.35 | 0.25 | 0.32 | 34 | 0.30 | 0.60 | 150 |
| champ | 22 ± 5 | 0.52 | 0.28 | 0.45 | 0.55 | 0.46 | 22 | 0.50 | 0.85 | 100 |

`sliders.ts` `boxingParams(difficulty)` interpolates a `BotParams` from the five sliders for the `custom` preset.

**Tests.** `boxing.test.ts` (determinism, damage, guard, stamina 40/s, guard half rate, jab limiter, tier bands, bot
never retreats), `pace.test.ts` (walking refill equals standing, evading dodge refunds, `resolveBackSteps`),
`keymap.test.ts`.

### 7.2 Keymap and phone mapping (`keymap.ts`)

`BoxingBindings { jab, cross, block, left, right, swayL, swayR, duck, in, out }`, `BOXING_KEYS` defaults,
`BOXING_HELP` rows, `boxingCommand(keys, bindings)`, `heldOnly(cmd)`, `boxingControllerState()`
(`{ blocking, slipArmed }`), `controllerBoxingCommand(stick, events, state, connected)` → `{ command, blocking,
slipArmed }`: stick x/y → strafe/forward; `gesture` → `phonePunchKind()` jab or cross with `punchPower`;
`block_start`/`block_end` → held guard; `emergency_power` → duck; a lateral stick flick → sway when armed.

### 7.3 Scene (`BoxingScene.ts`)

`BoxingSceneData { mode?: '1p' | 'card', tier?, bot?, seed?, practice?, personas? }`. Creates the match
(`botB` = chosen tier or `TIERS.pro` in card mode, `botA` = `TIERS.pro` in card mode), the HUD, the
`HealthTracker('boxing')` and badge, then `Engine3D.get()` → `new BoxingWorld(engine, P.red, card)`. Card mode
also creates `AgentLink`, `Book`, `ChipLedger`, and runs the betting panel (A/D corner, ↑↓ stake, Enter, Space).
`onEvent()` maps every `SimEvent` to sound, HUD and world fx. Practice mode drives `boxingPractice()` steps.
Dev hook: `window.__boxing` (the scene; `getSnapshot()`, `getEventLog()`, `match`).

Note for part 15: the persona colours from Fight Night reach the HUD names only. `BoxingWorld` is always built
with `P.red` gloves for the opponent and the spectator rig A is hard-coded `P.blue` gloves / `P.red` trunks.

### 7.4 HUD (`hud/BoxingHud.ts`)

`names`, `layout(W, H)`, `update(view, dt)`, `phonePunch()` (pooled green ring), `burst(word, color, size)`,
`showCard(title, color, sub, ms)`, `clearCard()`, `countdownNumber(n)`, `hitFlash(a)`, `gassed()`, `result(...)`,
`taunt(side, text)`, `cornerStatus(a, b)`, `betPanel(o)`, `clearBet()`, `pauseOverlay(...)`, `clearOverlay()`,
`setHint(text)`, `destroy()`.

### 7.5 Renderer (`render/`)

**`BoxingWorld`** — `constructor(engine, oppColor = P.red, spectator = false)`. Builds the world root, batch groups
`ring-static` (static, 60) and `ring-crowd` (dynamic, 60), `RingScene`, `Fx`, the opponent `OpponentRig(root,
oppColor, P.blue, device)`, re-parents the camera into a `CameraRig(root, camera, EYE_H)` and hangs `PlayerArms`
on the camera. Spectator mode disables the arms, adds `rigA = OpponentRig(root, P.blue, P.red, device)` and a
`ringside` orbit pivot for the camera. `show(w, h)` calls `lightSport(engine, 'boxing')`, `engine.show`,
`applyLook('boxing', { sky {top e7e8e4, horizon f7edda, ground 8d9caa}, tint ffffff, saturation 1.02, exposure
1.05, ambient abb7c0 })` and sets the FOV (44 spectator, 62 first person). `apply(v, dt, playerDown)`: FOV drama
(countdown push, count pull), yaw of each rig from `v.dir`, ringside orbit (`r = 6 + min(1.6, dist × 0.6)`,
`0.08 rad/s`) or first-person camera update, `opponentPose()` per rig with the other fighter's head as the glove
target in rig-local coordinates (`v3(-head.x, EYE_H + head.y, -dist)`), `aimLights`, DOF focus timer,
`ring.update`, `renderFrame`. Fx entry points: `hitFx`, `knockdownFx`, `guardBreakFx`, `confetti`, `cheer`,
`focusOn` (spectator only), `shake`, `punchKick`, `headOf`.

**`RingScene`** — canvas floor (weave texture + bump normal), logo torus, scuff decals, tape decals, apron with a
striped band, four posts with caps and three leather pads each, ropes as 6 sagging cylinder segments per side at
0.5/0.85/1.2 m, ringside desk with monitors and bottles, bell, four stools with buckets, crowd blocks (2 sides ×
4 rows × 20 fans, capsule bodies, dynamic batch, bob and `hop` on `cheer()`), four lamp cones with unlit bulbs,
arena floor (carpet), four walls (panel), a looping dust particle emitter, a 60 m unlit sky sphere, and an
`Environment` venue (terraces, seat backs, ribbons, piers, trusses, screen, sign, windows, ring steps).
`update(t, dt, cam)`, `cheer()`, `flash()`, `gd`.

**`OpponentRig`** — described in part 14.

**`PlayerArms`** — first-person arms on the camera; bones `L1 0.48`, `L2 0.46`, shoulders `(±0.32, −0.34, 0.02)`;
10 parts per arm; `apply(ArmPose, dt)`, `detach()`.

**`poses.ts`** — `OpponentPose` (x, y, z, `fallX/Y/Z`, pitch, roll, twist, headPitch, gloveL, gloveR, kL, kR,
squash), `ARM_L1/L2`, `ARM_SH_L/R`, `opponentPose(view, t, playerHead)`, `ArmPose`, `playerArmPose(view, t)`.
Guard targets `GUARD_L (−0.2, 1.36, −0.3)`, `GUARD_R (0.22, 1.33, −0.28)`; block `BLOCK_L (−0.12, 1.52, −0.26)`,
`BLOCK_R (0.12, 1.5, −0.26)`; knockdown `DOWN_PITCH 88` (topples backward, face up), `DOWN_FALL_Z 0.55`; punch
path: guard → pull-back → quadratic bezier to the target (windup first 45 % then 55 %), hold on `active`, ease
back on `recover`; body twist −18 (jab) / 30 (cross), pitch 13, lunge −0.22 m, squash 0.94 → 1.05. Dodge: duck
drops 0.4 m with pitch 26; sways move ±0.46 m with roll ∓24. `inReach()` keeps every glove target inside
`ARM_L1 + ARM_L2 − 0.012` so IK never snaps straight.

**`interp.ts`** — `lerpFighter`, `lerpView`.

---

## 8. Bowling and golf (export level)

**Bowling (`src/games/bowling/`).** Sim exports: `BowlingGame`, `BowlingBot`, `TIERS` (rookie
`{1.5, 0.2, 0.05, 0.2, 0.14}`, pro `{0.65, 0.11, 0.45, 0.5, 0.45}`, champ `{0.22, 0.045, 0.85, 0.86, 0.92}`;
champ timing must stay 0.92 for the sway test), `pocketShot`, `aimShot`, `hookDrift`, `releaseSpeed`, `clamp`,
`scoreFrames`, `frameDone`, `makePins`, `isStanding`, `pinRadius`, `stepBall`, `stepPins`, `resolveContacts`,
`anyMoving`, `speedOf`, `previewPath`, `Rng`, all `types` and `constants`. Keymap: `BOWLING_KEYS`, `BOWLING_HELP`,
`bowlingInput`, `MeterTracker`, `METER_HZ 1.2`, `meterValue`, `LANE_SPEED 0.5`, `ANGLE_SPEED 4`, `HOOK_STEP 0.2`,
`applyAim`, `defaultAim`, `bowlingControllerState()` (`{ hookArmed, armed }`), `controllerBowlingCommand(stick,
events, state, connected)` (hook on x edges, `block_start | placeholder_primary` locks the path,
`emergency_power | placeholder_secondary` arms, swing only when armed). Renderer: `BowlingWorld(engine)` with
`show`, `apply(v, aim, dt, path)`; `LaneScene` with `setBall`, `setAimPath(path, locked)` (63 blue cylinder
segments, radius 0.05 locked / 0.032 aiming), `setPins`, `update`; `WZ(z) = −z`.

**Golf (`src/games/golf/`).** Sim exports: `GolfRound`, `GolfConfig`, `ShotSim`, `simulateShot`, `CLUBS`,
`carryTable`, `FULL_CLUBS`, `HOLES`, `surfaceAt`, `pointInPolygon`, `COURSES`, `DEFAULT_COURSE`, `courseById`,
`GolfBot`, `TIERS` (rookie `{distNoise 0.24, aimNoiseDeg 11, greenSkill 0.2, riskiness 0.85}`, pro
`{0.11, 4.5, 0.55, 0.55}`, champ `{0.035, 1.2, 0.9, 0.3}`), `flight` (`BALL_R 0.03`, `CUP_DRAWN_R 0.2`,
`CUP_R = CUP_DRAWN_R + BALL_R`; the ball holes on contact at any speed). Keymap: `GOLF_KEYS`, `GOLF_HELP`,
`golfInput`, `SwingMeter` (`MeterState = idle | armed | power | accuracy | done`, `arm()`, `cancel()`,
`fromSwing(power)`, `POWER_SWEEP_S 1.6`, `ACC_SWEEP_S 1.0`, `ACC_SWEET 0.07`), `golfControllerState()`,
`controllerGolfCommand(stick, events, state)` (aim held on x, club edge on y, arm on
`block_start | placeholder_primary`, cancel on `emergency_power | placeholder_secondary`, `swingPower` from the
gesture). Renderer: `GolfWorld(engine)` with `CamMode = aim | flight | top`, `AimState`, `show`, `apply(v, aim,
dt)`; `CourseScene` (`triangulate`, `PREVIEW_N 24`, `BALL_DRAW_R 0.12`, `setHole`, `update`); `themes.ts`
(`THEMES`, `ThemePalette`, `buildProp`).

---

## 9. Phone controller protocol

**Phone → relay** (`ControllerSocket`): `hello` (slot, player, capabilities), `stick` (tilt vector),
`motion` (filtered acceleration/rotation sample), `gesture` (detected swing/punch: power 0..1, direction,
duration), `action` (`ControllerAction`: `block_start`, `block_end`, `emergency_power`, `placeholder_primary`,
`placeholder_secondary`), `activity` (`epochs[]`, `roms[]`, ≤120 each), `ping`.

**Relay → phone**: `hello` ack (with `telemetry`), `controller_status`, `game_state` `{ sport, blocking,
telemetry }`, `pong`, `error` (for example `controller_in_use`).

**Relay → game** (`/controller-game-ws`): every phone packet stamped with the sport the game declared through
`controllerInput.setSport()`; the roster is replayed to a game that connects after the phone.

**Game side**: `controllerInput.ingest()` sanitises and caps queues; `drain(id, sport)` returns only events
stamped for the active sport; `drainActivity(id)` hands epochs to `HealthTracker`. Per-sport meaning of the two
face buttons:

| Sport | A | B |
|---|---|---|
| Boxing | hold = guard (`block_start` / `block_end`) | duck (`emergency_power`) |
| Bowling | lock the path (`placeholder_primary`) | arm the throw (`placeholder_secondary`), then swing |
| Golf | arm the swing (`placeholder_primary`), then swing in any direction for power | cancel / toggle aim (`placeholder_secondary`) |

Outside boxing the phone's A also starts a 3 s countdown and a 2 s capture window for the swing.

---

## 10. Health and vitals

Movement: the phone's `ActivityTracker` produces 1-second epochs (`mean` acceleration, `peak`, `swings`,
`rotation`) and swing range-of-motion values, flushed every `activityReportMs` (5 s). The game's
`HealthTracker` opens a session at scene start (`POST /health/session` with sport, controller id, weight from
settings, source `keyboard`), forwards epochs (`/add`), and closes it (`/finish`) on scene shutdown or match end,
upgrading the source to `phone` if any movement epochs arrived; the server returns the computed row (active
seconds, kcal, swings, ROM mean). kcal = one per swing plus a MET term
(`metFor(sport, mean)` inside `MET_BAND`, `kcal/min = MET × 3.5 × kg / 200`). The HEALTH tab and the menu goal
card read `/health/summary?days=7`.

Vitals: `VitalsBridge.start({ cameraIndex, demo })` imports `@smartspectra/node-sdk` lazily, opens the camera
(`useCamera`), listens to `metrics` (decoded pulse, breathing, HRV with confidence), stores rows with confidence
≥ `MIN_CONFIDENCE` in the `vitals` table, and exposes state on `GET /vitals`. Presage's FDA clearance applies to
their iOS/Android apps only; the terms allow wellness use, not diagnosis. This development machine exposes no
`/dev/video*`, so only demo mode has been exercised end to end.

---

## 11. Fight Night: chips, bets, corners

`Book(startChips)` opens a `match` market at the start and a `round` market before each later round, with odds
from `oddsFor(form)` (`MARGIN 0.94`, bailout to 100 chips when the balance falls under 10). `BoxingScene` places,
settles (`round<n>` at each bell, `match1` at the end, a KO settles both) and records everything through
`ChipLedger` → `POST /chips/fight`, `/chips/fight/:id/bet|settle|finish`. `FightNightScene` reconciles the local
balance with `/chips/summary` (`startingChips(server, local)`) and shows the record and recent bets.

Corners: `AgentLink` sends a `BoxingSummary` (from `summarize.ts`) to `POST /agent/act` every `INTERVAL_MS`
(2.5 s) per corner with the persona text; the response is a `BoxScript` of timed actions executed by
`ScriptExecutor`. `strategize(match)` asks for a round plan (`STRATEGY_TOOL`) and shows the plan and taunts on the
HUD. Without a key, `fallback()` scripts drive both corners.

---

## 12. Server routes and schema

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/agent/health` | | service status (model, key present) |
| POST | `/agent/act` | `ActRequest { sport, corner, persona, summary, effort?, tick? }` | `ActResponse { output, latencyMs, source, model, error? }` |
| WS | `/agent/ws` | | agent event stream |
| WS | `/controller-ws`, `/controller-game-ws` | | phone relay (section 9) |
| GET | `/health/summary` | `days` (1..90, default 7) | `HealthSummary` |
| GET | `/health/sessions` | `limit` (1..500) | `SessionRow[]` |
| POST | `/health/session` | `{ sport, controller?, startedAt?, weightKg?, source? }` | `{ id }` |
| POST | `/health/session/:id/add` | `{ epochs[] (≤3600), roms[] (≤2000) }` | `{ ok }` |
| POST | `/health/session/:id/finish` | `{ endedAt?, source? }` | `SessionRow` |
| DELETE | `/health` | | `{ ok }` (clears all health rows) |
| GET | `/vitals` | | `VitalsState` |
| GET | `/vitals/devices` | | `{ checked, devices[] }` |
| GET | `/vitals/history` | `minutes` (1..1440, default 30) | rows |
| POST | `/vitals/start` | `{ cameraIndex?, demo? }` | `VitalsState` |
| POST | `/vitals/stop` | | `VitalsState` |
| GET | `/chips/summary` | | `ChipSummary` |
| GET | `/chips/ledger` | `limit` (1..2000) | ledger rows |
| POST | `/chips/fight` | `{ startedAt, seed, nameA, nameB, chipsBefore }` | `{ id, balance }` |
| POST | `/chips/fight/:id/bet` | `{ at, market, kind, round, corner, stake, odds }` | `{ id }` |
| POST | `/chips/fight/:id/settle` | `{ market, winner, bets[], ledger[] }` | `{ ok, balance }` |
| POST | `/chips/fight/:id/finish` | `{ endedAt, winner, by, round, chipsAfter, betsWon, betsLost, net, ledger[] }` | `{ ok, balance }` |
| DELETE | `/chips` | | `{ balance }` (reset to 500) |

SQLite (`server/health.ts`, `data/health.sqlite`):

| Table | Columns |
|---|---|
| `sessions` | `id, sport, controller, source, started_at, ended_at, duration_ms, weight_kg, active_seconds, active_minutes, kcal, …` (swings, ROM mean and the rest of `SessionRow`) |
| `epochs` | `session_id → sessions(id) cascade, t, mean, peak, swings, rotation` |
| `swings` | `session_id, rom` |
| `vitals` | `at, pulse, breathing, hrv_rmssd, confidence` (index on `at`) |
| `fights` | `id, started_at, ended_at, seed, name_a, name_b, winner, by, round, chips_before, chips_after, bets_won, bets_lost, net` |
| `bets` | `id, fight_id → fights(id) cascade, at, market, kind, round, corner, stake, odds, result ('open' default), paid` |
| `chip_ledger` | `id, fight_id (nullable), at, reason, amount, balance` |

---

## 13. PlayCanvas guide: how this project uses the engine

### 13.1 Engine-only, manual everything

`Engine3D.create()` (`src/engine3d/Engine3D.ts`):

```ts
const device = await createGraphicsDevice(canvas, { deviceTypes: [DEVICETYPE_WEBGL2], antialias: true, powerPreference: 'high-performance' })
device.maxPixelRatio = 1
const opts = new AppOptions()
opts.graphicsDevice = device
opts.componentSystems = [RenderComponentSystem, CameraComponentSystem, LightComponentSystem, ParticleSystemComponentSystem]
opts.resourceHandlers = []          // no asset loaders: everything is built in code
opts.lightmapper = Lightmapper
opts.batchManager = BatchManager
const app = new AppBase(canvas); app.init(opts)
app.setCanvasFillMode(FILLMODE_NONE); app.setCanvasResolution(RESOLUTION_AUTO)
app.start(); app.autoRender = false // Phaser calls engine.renderFrame() → app.render()
```

Consequences:

- Only `render`, `camera`, `light` and `particlesystem` components exist. Adding an `anim`, `script`, `sprite`
  or `collision` component needs its system in `componentSystems`.
- `resourceHandlers` is empty, so `app.assets.loadFromUrl` cannot load glTF/GLB, images or JSON. To import a
  modelled character you would register `ContainerHandler`, `TextureHandler` (and `AnimClipHandler` for
  animations) in `resourceHandlers`, then use `app.assets.loadFromUrl(url, 'container', cb)` and
  `asset.resource.instantiateRenderEntity()`. Nothing in the repo does this yet; all geometry is primitives and
  procedural meshes.
- The canvas is `position:absolute; inset:0; z-index:0; pointer-events:none`, created inside `#game` before the
  Phaser canvas. `Engine3D.show()` displays it and resizes; `hide()` hides it and disables every world.
- The camera clears to transparent black (`clearColor (0,0,0,0)`), so Phaser draws over the 3D frame.
- One `Engine3D` per page (`Engine3D.get()` memoises the promise; `peek()` returns it if ready).

### 13.2 Coordinates and units

- Metres, Y up. Ring centre is the origin. The opponent rig faces `−Z` at the player; the player rig (spectator
  mode) faces `+Z`. Yaw in degrees around Y, computed as `atan2(-dir.x, -dir.z)` for A and `atan2(dir.x, dir.z)`
  for B from the sim's facing vector.
- Primitives are unit sized: box 1×1×1, sphere diameter 1, cylinder/capsule/cone height 1 and diameter 1 along
  local Y, plane 1×1 in XZ facing `+Y`, torus about 1 across. Scale sets the real size.
- `setLocalPosition/Rotation/EulerAngles/Scale` are relative to the parent; `setPosition/setEulerAngles/lookAt`
  are world space. Rigs set the root in world space and everything else locally.
- When a part needs a yaw and a tilt, nest pivots (`pivot()`), so the order is explicit instead of relying on
  Euler composition.

### 13.3 The toolkit (`src/engine3d/`)

| File | Exports | Notes |
|---|---|---|
| `Engine3D.ts` | `Engine3D` (`get()`, `peek()`, `canvas`, `app`, `camera`, `key`, `fill`, `rim`, `post`, `quality`, `setQuality(q)`, `newWorld(name)`, `applyLook(name, look)`, `aimLights(target, camPos)`, `batchGroup(name, dynamic, size)`, `generateBatches(ids)`, `bakeStatic(world)`, `show(world, w, h)`, `hide()`, `resize(w, h)`, `renderFrame()`), `WorldLook` | Lights: key directional `fff4dc` 1.35 with PCF3 32F shadows (1024 medium, 2048 high, off on low); fill omni `6f86c9` 0.5; rim spot `ffd7a0` 2.2. `setQuality` also sets `maxPixelRatio` (1 on low, up to 2 otherwise). |
| `materials.ts` | `shade(hex, k)`, `col(hex, a)`, `applyToon(m)`, `MatOpts`, `flatMat(hex, o)`, `toonMat`, `shinyMat`, `matteMat`, `unlitMat(hex, twoSided)`, `emissiveMat(hex, strength, twoSided)`, `inkMat()` | `flatMat`: metalness 0.05, gloss 0.45, specular 0.35, Schlick fresnel, `useSkybox`, optional diffuse and normal maps with tiling, toon chunks by default. `applyToon` overrides the GLSL chunks `lightDiffuseLambertPS` (two-band step at 0.30–0.36) and `combinePS` (hard specular, reflection at 0.6, rim band). `inkMat()` is a single shared unlit `141414` material with `CULLFACE_FRONT`. Always call `m.update()` after changing a material. |
| `primitives.ts` | `Prim`, `PartOpts { pos, scale, euler, outline, outlineK, shadows, receive, batch }`, `part()`, `pivot()`, `orientSegment(e, a, b, r)`, `twoBoneIK(S, T, l1, l2, hint)`, `facetedSphere()`, `decal()`, `billboard()` | `part()` adds a `<name>:ink` inverted-hull child scaled by `1 + k / max(0.05, scale)` per axis with `k = outlineK ?? 0.03` (3 cm of ink in world units) unless `outline: false`. `orientSegment` positions a unit cylinder from `a` to `b` (parent-local) with radius `r`. `twoBoneIK` clamps the reach to `l1 + l2 − 0.002` and bends toward `hint`. `decal` is an unlit alpha plane (`depthWrite` off, no culling, no tonemap). `billboard` returns a holder entity; rotate the holder toward the camera each frame. |
| `textures.ts` | `noiseTex`, `bumpTex`, `stripeTex`, `glowTex`, `coneTex`, `crowdTex`, `scuffTex`, `leatherTex`, `weaveTex`, `woodTex`, `carpetTex`, `panelTex`, `grassTex` | All drawn on a 2D canvas and uploaded with `new Texture(device, {...}).setSource(canvas)`; repeat addressing, mipmaps. Pattern to copy for a new texture (tattoo, logo, hair strands): draw, `toTexture()`. |
| `springs.ts` | `Spring(x, k)`, `Spring3(k)`, `lerp`, `clamp01`, `easeOutCubic`, `easeInOut`, `V3`, `v3`, `bezier2` | Critically damped: `to(target, dt)` returns the new value. Stiffness k is in 1/s²; rigs use 70–140, the first-person head 160–220. |
| `env.ts` | `SkyGradient { top, horizon, ground, sun? }`, `gradientCubemap`, `envAtlasFromGradient` | `applyLook` caches one env atlas per world name and assigns `scene.envAtlas`. |
| `environment.ts` | `Environment` (`mat(hex, glow)`, `box`, `beam`, `truss`, `label`, `screen`), `lightSport(engine, sport)`, `landscapePeak()` | Static venue scenery with cached materials; `lightSport` resets the light rig per sport (boxing key at euler (28, −25, 0), intensity 1.5, shadow distance 28; camera near 0.05 / far 80 indoors). |
| `post.ts` | `Quality`, `Post` (`frame: CameraFrame`, `setQuality`, `grade(tint, saturation)`, `focus(distance | null)`) | `CameraFrame` with RGBA16F, ACES, sharpness 0.25, bloom 0, vignette 0.12, grading on, DOF off unless `focus()` on high, TAA off, SSAO only on high. |
| `fx.ts` | `FxKind = sweat | dust | sparks | confetti | splash | grass | pinSpark`, `Fx(root).burst(kind, x, y, z)` | Pooled one-shot `particlesystem` emitters, up to 4 per kind, built from `Curve`/`CurveSet` graphs and the engine's default soft-spot texture. |
| `CameraRig.ts` | `CameraRig(parent, camera, eyeH)`: `update(dt, pos, yawDeg, sway, duck, stepPhase, eyeH, lookDown)`, `kick(power)`, `punchKick()`, `setBaseFov(f)` | First-person chain `root → head → bob → shake → camera`. |
| `water.ts` | `waterTextures(device)` | Golf water. |

### 13.4 Frame cycle, batching, baking

- Static scenery that shares a material goes into a static batch group (`engine.batchGroup('ring-static')`,
  `part(..., { batch: B })`, then `engine.generateBatches([...])` once after the world is built). The crowd uses
  a dynamic group because it moves. Rigs are not batched (they move every frame and are few).
- `bakeStatic(world)` runs the lightmapper for ambient occlusion on static parts; it is skipped on low quality.
  No world calls it today; it is available for a scene that wants baked occlusion on its static batch.
- Every world calls `engine.aimLights(midpoint, cameraPos)` each frame so fill and rim follow the action.
- `Engine3D.renderFrame()` is the only place `app.render()` runs; never enable `autoRender`.

### 13.5 Gotchas already paid for

1. **Shared camera.** `PlayerArms` destroys any stale `arms` child on the camera and `detach()`es on `hide()`.
   Anything else parented to the camera needs the same care.
2. **`orientSegment` roll.** Boxes on IK segments spin unpredictably; use spheres and cylinders.
3. **Ink hull thickness is world-space.** A part scaled to 0.05 or less gets a hull scaled by `1 + k / 0.05`;
   tiny detail should use `outline: false` (eyes, laces, seams already do).
4. **Foot clearance.** The boot sole sits 3 cm above `y = 0` because the idle bob is ±2 cm and the ink hull adds
   3 cm below; lowering it puts black ink through the canvas.
5. **Knockdown fall lives on `lean`, not `body`.** Applying the drop inside the pitched frame left the fighter
   floating at chest height once horizontal.
6. **Per-call materials.** `flatMat` has no cache; nine materials per rig, created once.
7. **Hidden browser pane.** The desktop app's preview pane throttles timers and reports a zero window size when
   hidden; verify with the pane visible or through `window.__advance(ms)`.
8. **Alpha decals sort in the transparent layer.** Keep them thin, `depthWrite` off, and above the surface by a
   few millimetres (`y 0.003..0.006` on the canvas).
9. **`maxPixelRatio`** is 1 during creation and raised by `setQuality`; resizing goes through
   `app.resizeCanvas(w, h)` from Phaser's resize event.
10. **Destroy what you create.** Textures and materials made per instance should be destroyed on the owner's
    `destroy` event (`Environment.label` shows the pattern).

### 13.6 PlayCanvas symbols the repo uses

`AppBase, AppOptions, Entity, Color, Vec3, Curve, CurveSet, Mesh, MeshInstance, StandardMaterial, Texture,
CameraComponent, CameraFrame, GraphicsDevice, createGraphicsDevice, createSphere, calculateNormals, Lightmapper,
BatchManager, EnvLighting, RenderComponentSystem, CameraComponentSystem, LightComponentSystem,
ParticleSystemComponentSystem` and the constants `ADDRESS_REPEAT, BAKE_COLOR, BLEND_ADDITIVE, BLEND_NORMAL,
CULLFACE_FRONT, CULLFACE_NONE, DEVICETYPE_WEBGL2, EMITTERSHAPE_BOX, EMITTERSHAPE_SPHERE, FILLMODE_NONE,
FILTER_LINEAR_MIPMAP_LINEAR, FOG_LINEAR, FOG_NONE, FRESNEL_NONE, FRESNEL_SCHLICK, LIGHTFALLOFF_INVERSESQUARED,
LIGHTFALLOFF_LINEAR, PIXELFORMAT_RGBA16F, PIXELFORMAT_RGBA8, RESOLUTION_AUTO, SHADERLANGUAGE_GLSL,
SHADOW_PCF3_32F, SSAOTYPE_LIGHTING, SSAOTYPE_NONE, TEXTUREPROJECTION_CUBE, TONEMAP_ACES`.

Reference: the engine API at `https://api.playcanvas.com/engine/` and the source in
`node_modules/playcanvas/src/` (the shader chunks overridden by `applyToon` live under
`scene/shader-lib/chunks/`).

---

## 14. The boxer rig as built today (`OpponentRig.ts`)

Constructor: `new OpponentRig(parent, color = P.red /* gloves */, trunks = P.blue, device?)`. Skin is fixed:
`SKIN f3b98c`, `SKIN_HI ffd2a6`, `SKIN_LO c8845c`, ink `141414`. Materials (`M`): `skin`, `skinHi`, `skinLo`,
`glove` (leather map, tiling 3), `gloveLo` (`shade(color, 0.62)`), `trunk` (weave map, tiling 6), `gold`,
`white`, `dark`.

Hierarchy and parts (positions in metres in the `body` frame unless noted; scale is the full size):

| Group | Parent | Parts (name: prim, pos, scale) |
|---|---|---|
| Skeleton | — | `root` → `lean (0, 0.95, 0)` → `body (0, −0.95, 0)` |
| Legs ×2 (`s = ∓1`) | `hip` pivot at `(s·0.13, 0.95, 0)` | glute sphere (0, −0.14, 0.055) 0.2×0.24×0.2; thigh cyl (0, −0.23, 0) 0.16×0.44; quad sphere skinHi (0, −0.24, −0.025) 0.185×0.29×0.175 no ink; knee sphere (0, −0.45, 0) 0.17; shin cyl (0, −0.67, 0.01) 0.14×0.42; calf sphere skinHi (0, −0.63, 0.035) 0.19×0.24×0.175 no ink; ankleWrap box white (0, −0.77, 0.005) 0.17×0.05×0.175 no ink; boot box white (0, −0.83, −0.04) 0.16×0.13×0.3; bootSole box dark (0, −0.9025, −0.04) 0.175×0.035×0.315 no ink; bootTongue, bootLaces |
| Trunks | `body` | trunks box (0, 0.9, 0) 0.5×0.16×0.31; trunksWaist (0, 1.04, 0) 0.44×0.19×0.28 no ink; belt gold (0, 1.1, 0) 0.47×0.075×0.295; beltTrim white; stripe ×2 white at x ±0.252 |
| Abdomen | `body` | abs box (0, 1.2, 0) 0.26×0.17×0.26 no ink; oblique ×2 at x ±0.155 rolled ∓12°; absLine and three absRow strips in skinLo on the front face (z −0.132) |
| Ribcage | `body` | ribs (0, 1.295, 0) 0.4×0.1×0.28; **torso** (0, 1.38, 0) 0.5×0.24×0.3; lat ×2 at x ±0.235; pec ×2 spheres skinHi at (±0.115, 1.418, −0.126) 0.215×0.155×0.135; sternum; clav ×2 cylinders rolled ∓78° |
| Shoulders | `body` | shoulders box (0, 1.465, 0.01) 0.6×0.13×0.26; delt ×2 spheres skinHi at (±0.295, 1.445, 0) 0.21×0.22×0.21; trap ×2; neck cyl (0, 1.57, 0) 0.15×0.13×0.14 |
| Head | `headPivot` at `(0, 1.62, 0)` | head sphere (0, 0.15, 0) 0.32×0.34×0.32; jaw box (0, 0.055, −0.035) 0.26×0.12×0.26; chin box; hair sphere dark (0, 0.23, 0.04) 0.3×0.22×0.3 no ink; brow, nose, ear ×2, eye ×2 dark spheres at (±0.07, 0.17, −0.15), mouthLine, guardTeeth white |
| Arms ×2 | `body` (IK) | `armUpper` cyl 0.12×`ARM_L1`; bicep sphere skinHi (0, −0.13, 0) 1.45×0.6×1.45 (bone-local: Y is the bone axis, 1 unit = bone length); tricep; `armFore` cyl 0.1×`ARM_L2`; flexor; `armGlove` sphere 0.22×0.2×0.24 with cuff, trim, seam torus and thumb (glove-local: −Z is the punching face, +Z the wrist); `armElbow` sphere 0.13 |

Totals per rig: 84 primitives, 34 of them with ink hulls, so about 118 mesh instances and 9 materials. Two
rigs in Fight Night: about 236 mesh instances. Budget for a new look: stay under about 130 primitives per rig
and keep the material count in single digits.

`apply(pose, worldPos, yawDeg, dt, moving, squash, t)` each frame: springs the body offset (k 90), pitch/roll
(70), twist (90), head (80), gloves (140), squash (120), fall (70); scales `body` by
`(1/√sq, sq, 1/√sq)` with a 1.2 % breathing sine; swings the hip pivots ±26° with `walk += moving × dt × 2.6`;
sets `root` world position and yaw; puts the fall on `lean`; runs two-bone IK for both arms with bend hints
`(∓1, −0.7, 0.2)`.

---

## 15. Recipe: different, more detailed cartoon boxers

Goal: the player picks or is matched against different people, each with a recognisable body, face, kit and
colours, while the sim, poses and IK stay exactly as they are.

### 15.1 Where the look is decided today, and what to change

| Today | Change |
|---|---|
| `OpponentRig(parent, gloveColor, trunksColor, device)`; skin constants at the top of the file | `OpponentRig(parent, look: BoxerLook, device)`; keep a `lookFrom(color, trunks)` helper for the two existing call sites |
| `BoxingWorld(engine, oppColor, spectator)` builds the opponent with `P.red` gloves and rig A with `P.blue`/`P.red` | `BoxingWorld(engine, looks: { a: BoxerLook; b: BoxerLook }, spectator)` |
| `BoxingScene` passes `P.red` regardless of tier or persona; `Persona { name, style, color }` | `Persona` gains `look: BoxerLookId`; 1P picks a look per tier or from a new opponent selector in `PreFightScene`; the HUD keeps using `color` |
| `FightNightScene.PERSONAS` four entries | each entry names its look; new personas are one line each |

### 15.2 Define the look

Create `src/games/boxing/render/looks.ts`:

```ts
import { P } from '../../../theme'
export type BoxerLookId = 'knuckles' | 'professor' | 'lucky' | 'maggie' | 'house'
export interface BoxerLook {
  id: BoxerLookId
  skin: number; skinHi: number; skinLo: number
  hair: { style: 'buzz' | 'flat' | 'mohawk' | 'bald' | 'bun' | 'afro'; color: number }
  beard?: 'stubble' | 'goatee' | 'full'
  gloves: number; trunks: number; trim: number; boots: number
  headgear?: 'none' | 'headguard'
  tattoo?: { where: 'chest' | 'shoulderL' | 'shoulderR' | 'back'; tex: 'skull' | 'flame' | 'star' }
  build: {
    height: number      // 0.94 .. 1.08, applied on root (see 15.4)
    shoulders: number   // multiplies delt/shoulder/trap widths, 0.85 .. 1.25
    chest: number       // multiplies torso/ribs/pec x-z scale
    waist: number       // multiplies abs/oblique/trunks widths (rounder fighters > 1)
    limbs: number       // multiplies thigh/shin/upper/fore diameters
    jaw: number         // jaw box width, 0.9 .. 1.2
  }
}
export const LOOKS: Record<BoxerLookId, BoxerLook> = {
  knuckles: { id: 'knuckles', skin: 0xf3b98c, skinHi: 0xffd2a6, skinLo: 0xc8845c, hair: { style: 'buzz', color: 0x2b1d14 }, beard: 'stubble', gloves: P.red, trunks: 0x1c1c1c, trim: P.red, boots: 0x1c1c1c, build: { height: 1.0, shoulders: 1.2, chest: 1.15, waist: 1.1, limbs: 1.15, jaw: 1.15 } },
  professor: { id: 'professor', skin: 0x8d5a3c, skinHi: 0xa8714f, skinLo: 0x6b4128, hair: { style: 'flat', color: 0x141414 }, gloves: P.blue, trunks: 0xf4f1e6, trim: P.blue, boots: 0xf4f1e6, build: { height: 1.06, shoulders: 0.95, chest: 0.95, waist: 0.9, limbs: 0.9, jaw: 0.95 } },
  lucky: { id: 'lucky', skin: 0xe9b58a, skinHi: 0xffd0a8, skinLo: 0xbf835a, hair: { style: 'mohawk', color: P.gold }, gloves: P.gold, trunks: P.magenta, trim: P.gold, boots: 0xffffff, build: { height: 0.98, shoulders: 1.0, chest: 1.0, waist: 0.95, limbs: 1.0, jaw: 1.0 } },
  maggie: { id: 'maggie', skin: 0xd7a07b, skinHi: 0xf0bd97, skinLo: 0xa8734f, hair: { style: 'bun', color: 0x7a2e12 }, gloves: P.green, trunks: 0x1b2a6b, trim: P.green, boots: P.green, headgear: 'headguard', build: { height: 0.96, shoulders: 1.05, chest: 0.95, waist: 0.9, limbs: 1.05, jaw: 0.9 } },
  house: { id: 'house', skin: 0xf3b98c, skinHi: 0xffd2a6, skinLo: 0xc8845c, hair: { style: 'buzz', color: 0x141414 }, gloves: P.red, trunks: P.blue, trim: 0xffffff, boots: 0xffffff, build: { height: 1, shoulders: 1, chest: 1, waist: 1, limbs: 1, jaw: 1 } },
}
export const lookFrom = (gloves: number, trunks: number): BoxerLook => ({ ...LOOKS.house, id: 'house', gloves, trunks })
```

`house` reproduces the current model exactly, so nothing changes until a scene passes a different look.

### 15.3 Apply the look inside `OpponentRig`

Keep the constructor body; replace the constants and the material set:

```ts
const M = {
  skin: flatMat(look.skin, { gloss: 0.5, specular: 0.4 }),
  skinHi: flatMat(look.skinHi, { gloss: 0.58, specular: 0.5 }),
  skinLo: flatMat(look.skinLo, { gloss: 0.32, specular: 0.22 }),
  glove: flatMat(look.gloves, { gloss: 0.7, specular: 0.7, metalness: 0.1, diffuseMap: leather, tiling: 3 }),
  gloveLo: flatMat(shade(look.gloves, 0.62), { gloss: 0.55, specular: 0.5, diffuseMap: leather, tiling: 4 }),
  trunk: flatMat(look.trunks, { gloss: 0.4, diffuseMap: weave, tiling: 6 }),
  trim: flatMat(look.trim, { gloss: 0.6 }),
  boot: flatMat(look.boots, { gloss: 0.6 }),
  hair: flatMat(look.hair.color, { gloss: 0.3 }),
  gold: flatMat(P.gold, { gloss: 0.7, specular: 0.6, metalness: 0.3 }),
  white: flatMat(0xffffff, { gloss: 0.6 }),
  dark: flatMat(INK, { gloss: 0.25 }),
}
```

Then thread `build` multipliers into the existing `part()` calls. Only x and z scales and x positions change;
y positions and heights stay, which is what keeps the shoulders at `ARM_SH_*` and the hip at 0.95:

```ts
const b = look.build
part(this.body, 'shoulders', 'box', M.skin, { pos: { x: 0, y: 1.465, z: 0.01 }, scale: { x: 0.6 * b.shoulders, y: 0.13, z: 0.26 } })
for (const s of [-1, 1]) part(this.body, 'delt', 'sphere', M.skinHi, { pos: { x: s * 0.295 * b.shoulders, y: 1.445, z: 0 }, scale: { x: 0.21 * b.shoulders, y: 0.22, z: 0.21 * b.shoulders } })
this.torso = part(this.body, 'torso', 'box', M.skin, { pos: { x: 0, y: 1.38, z: 0 }, scale: { x: 0.5 * b.chest, y: 0.24, z: 0.3 * b.chest } })
part(this.body, 'trunks', 'box', M.trunk, { pos: { x: 0, y: 0.9, z: 0 }, scale: { x: 0.5 * b.waist, y: 0.16, z: 0.31 * b.waist } })
part(hip, 'thigh', 'cylinder', M.skin, { pos: { x: 0, y: -0.23, z: 0 }, scale: { x: 0.16 * b.limbs, y: 0.44, z: 0.16 * b.limbs } })
const up = part(this.body, n + 'Upper', 'cylinder', M.skin, { scale: { x: 0.12 * b.limbs, y: ARM_L1, z: 0.12 * b.limbs } })
```

Note that `orientSegment` overwrites a segment's scale every frame with `(r·2, len, r·2)`; the arm radius passed
to `this.arm()` (`0.06` upper, `0.05` fore) is what to multiply by `b.limbs`, not the constructor scale.

### 15.4 Height without breaking the poses

Scaling `root` by `h = look.build.height` scales every local metre, including the glove target computed by
`BoxingWorld` in rig-local units. Compensate in one place, `BoxingWorld.apply`:

```ts
const hB = this.opp.height, hA = this.rigA?.height ?? 1
const targetB = v3(-v.a.head.x / hB, (EYE_H + v.a.head.y) / hB, -v.dist / hB)
const targetA = v3(-v.b.head.x / hA, (EYE_H + v.b.head.y) / hA, -v.dist / hA)
```

and in the rig constructor `this.root.setLocalScale(h, h, h); this.height = h`. `root` is never rescaled in
`apply()`, so the scale persists. Keep `height` inside 0.94..1.08: the sim's reach and `EYE_H` do not change, so a
much taller model punches visibly short and a much shorter one over-reaches. Widths can vary far more (0.85..1.25).

### 15.5 Hair, beards, headgear, tattoos

All of these hang on `this.head` (the pivot at `(0, 1.62, 0)`), so they follow head pitch. Positions are in the
head frame, where the skull sphere is centred at `(0, 0.15, 0)` with radius about 0.16.

```ts
switch (look.hair.style) {
  case 'buzz': part(this.head, 'hair', 'sphere', M.hair, { pos: { x: 0, y: 0.23, z: 0.04 }, scale: { x: 0.3, y: 0.22, z: 0.3 }, outline: false }); break
  case 'flat': part(this.head, 'hair', 'box', M.hair, { pos: { x: 0, y: 0.31, z: 0.02 }, scale: { x: 0.3, y: 0.08, z: 0.3 } }); break
  case 'mohawk': for (let i = 0; i < 5; i++) part(this.head, 'spike', 'cone', M.hair, { pos: { x: 0, y: 0.36, z: 0.11 - i * 0.055 }, scale: { x: 0.07, y: 0.16 + (2 - Math.abs(i - 2)) * 0.03, z: 0.07 }, euler: { x: -10 + i * 8, y: 0, z: 0 } }); break
  case 'bun': part(this.head, 'hair', 'sphere', M.hair, { pos: { x: 0, y: 0.23, z: 0.04 }, scale: { x: 0.3, y: 0.22, z: 0.3 }, outline: false }); part(this.head, 'bun', 'sphere', M.hair, { pos: { x: 0, y: 0.34, z: 0.1 }, scale: { x: 0.13, y: 0.13, z: 0.13 } }); break
  case 'afro': part(this.head, 'hair', 'sphere', M.hair, { pos: { x: 0, y: 0.2, z: 0.03 }, scale: { x: 0.42, y: 0.42, z: 0.42 } }); break
  case 'bald': break
}
if (look.beard === 'stubble') part(this.head, 'beard', 'box', M.skinLo, { pos: { x: 0, y: 0.05, z: -0.04 }, scale: { x: 0.265, y: 0.11, z: 0.265 }, outline: false })
if (look.beard === 'goatee') part(this.head, 'goatee', 'box', M.hair, { pos: { x: 0, y: 0.03, z: -0.17 }, scale: { x: 0.09, y: 0.07, z: 0.06 } })
if (look.beard === 'full') part(this.head, 'beard', 'sphere', M.hair, { pos: { x: 0, y: 0.04, z: -0.03 }, scale: { x: 0.3, y: 0.18, z: 0.3 } })
if (look.headgear === 'headguard') {
  part(this.head, 'guard', 'torus', M.trim, { pos: { x: 0, y: 0.18, z: 0 }, euler: { x: 90, y: 0, z: 0 }, scale: { x: 0.36, y: 0.3, z: 0.36 } })
  part(this.head, 'guardTop', 'box', M.trim, { pos: { x: 0, y: 0.31, z: 0.02 }, scale: { x: 0.12, y: 0.05, z: 0.3 } })
}
```

Tattoos are `decal()` planes a few millimetres off a flat face, parented to `body` (or to a segment for an arm,
where a torus-wrapped band of colour is safer than a plane because of the roll rule). Draw the art with the
`textures.ts` canvas pattern and give it alpha:

```ts
if (look.tattoo?.where === 'chest') decal(this.body, 'tattoo', tattooTex(device, look.tattoo.tex), { pos: { x: 0.11, y: 1.42, z: -0.152 }, w: 0.14, h: 0.12, euler: { x: -90, y: 0, z: 0 }, opacity: 0.85 })
```

(`decal` planes face `+Y`; rotating −90° about X points them toward `−Z`, the front of the rig; culling is off so
either sign works.)

### 15.6 Silhouettes that read from ringside

The ringside camera sits 6 to 7.6 m out at 2.1 m high; faces are small, bodies and colours are what the eye reads.
Spend the budget on: shoulder width, waist, glove size (the `glove` scale is `0.22×0.2×0.24`; a 1.15× glove reads
as a heavy hitter), trunk length (`trunks` y scale and the stripe/trim colour), and one head landmark (mohawk,
bun, headguard, big beard). Suggested mapping from the personas' styles: brawler = wide, thick limbs, stubble,
dark trunks; counter-puncher = tall, narrow, flat top, white kit; showboat = gold mohawk, magenta trunks, white
boots; stamina monster = compact, headguard, bun. Faces stay simple: eyes, brow, nose, mouth, guard teeth are
already there; a `jaw` width multiplier is enough to differentiate.

### 15.7 Wire the selection

1. `FightNightScene.PERSONAS[i].look = 'knuckles' | 'professor' | 'lucky' | 'maggie'`.
2. `BoxingScene.create()`: in card mode `new BoxingWorld(engine, { a: LOOKS[ps[0].look], b: LOOKS[ps[1].look] },
   true)`; in 1P `{ a: LOOKS.house, b: LOOKS[tierLook[d.tier ?? 'rookie']] }` or a look chosen on the pre-fight
   screen (`PreFightScene` already cycles presets; add a row cycling `Object.keys(LOOKS)` and pass `look` in the
   scene data).
3. `hud.names[1]` should show the persona name instead of `THE HOUSE (ROOKIE)` when a look is chosen.
4. `environmentPreview.ts`: read `?look=` and pass it to `BoxingWorld` so every look can be screenshotted without
   playing.

### 15.8 Verify

- `npm run typecheck` and `npm test` (add `looks.test.ts`: every `PERSONAS` entry maps to a `LOOKS` key; every look's
  `build.height` is within 0.94..1.08; `lookFrom()` equals `LOOKS.house` apart from the two colours).
- `http://localhost:5174/environment-preview.html?sport=boxing&look=lucky` for a still of each look; both rigs
  are built in spectator mode.
- In a match: `window.__boxing.getSnapshot()` for state; `window.__advance(ms)` to step the clock if the pane is
  throttled. Check a jab, a cross, a block, a duck and a knockdown per look: gloves must still reach the
  opponent's head (15.4), the fall must end flat on the canvas, and no ink hull may cross the floor.
- Watch the mesh-instance count: two rigs of about 130 primitives with hulls are fine on the medium tier; if a
  look adds many outlined parts, prefer `outline: false` on the small ones.

### 15.9 Beyond primitives (optional, larger)

If a sculpted look is wanted later: build the head or torso with `facetedSphere()` (hard-edge normals give a
cartoon read at no texture cost), or register `ContainerHandler` and `TextureHandler` in `resourceHandlers`
(13.1) and load a GLB per look, parenting the instantiated entity under `body` and hiding the primitive parts it
replaces. The poses, IK targets and springs keep working as long as the glove entities and the `head` pivot keep
their names and frames. Rigged animation (an `anim` component and a state graph) is a separate project: the sim's
states would map to clips, and `poses.ts` would be bypassed for that rig.

---

## 16. Dev hooks and verification

| Hook | Where | Use |
|---|---|---|
| `window.__game` | `main.ts` (dev) | Phaser game; `game.loop.actualFps` for frame-time checks |
| `window.__advance(ms)` | `main.ts` (dev) | Step the game clock synchronously (tweens follow it in dev) |
| `window.__pad` | `main.ts` (dev) | `controllerInput`; `ingest(packet)` to inject phone packets without a phone |
| `window.__errs` | `main.ts` (dev) | Uncaught error stacks |
| `window.__boxing` | `BoxingScene` | Live scene: `match`, `getSnapshot()`, `getEventLog()` |
| `environment-preview.html?sport=` | `src/dev/environmentPreview.ts` | Static 3D review, no match |
| `motion.html`, `vitals.html` | labs | Motion and vitals diagnostics |
| `npm run fake-phone` | `scripts/fakePhone.ts` | Synthetic phone over the relay |
| `AGENT_PORT=8791 npm run agent` | `server/agent.ts` | Second service for route checks |

Standard checks before a commit: `npm test`, `npm run build`, one screenshot per changed scene at 1280×800 with
the preview pane visible, and for renderer changes a before/after frame-time read on the medium tier.
