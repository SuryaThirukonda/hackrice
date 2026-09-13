# Tempo — handoff

Everything the project does as of commit `77fc829` (the `treys` merge and its follow-ups), how it fits
together, how to run and verify it, and what is still open. Written for someone who has never opened this repo. Read `README.md` for the short
version; this is the long one.

## 1. What Tempo is

A browser arcade of three motion sports (boxing, bowling, golf) plus an AI-versus-AI "Fight Night" betting
mode, played on a big screen with a keyboard or with phones as motion controllers, with a health layer
that turns the phone's motion into activity records and, optionally, a camera into pulse and breathing.

Built at HackRice 16 (health track and the Presage sponsor challenge). Formerly "The House Always Plays";
the opponent is still called "The House".

## 2. Stack and hard rules

| Layer | Technology |
|---|---|
| Game UI, menus, HUD, input | Phaser 3.90 on a transparent canvas |
| 3D worlds | PlayCanvas 2.22, engine-only, rendered behind Phaser |
| Phone pages and lab pages | React 19, separate Vite entries |
| Server | Node 24, `tsx`, one process (`server/agent.ts`) on port 8790 |
| Build | Vite 8, TypeScript strict with `erasableSyntaxOnly`, `noUnusedLocals`, `noUnusedParameters` |
| Tests | vitest, 29 files, 251 tests, all deterministic; one Python test for the webcam head tracker |
| Local data | SQLite through Node's built-in `node:sqlite`, file `data/health.sqlite` (git-ignored) |

Rules that everything else depends on:

- **The simulations are the authority.** Each sport is a deterministic 120 Hz sim under `src/games/<sport>/sim/`.
  Renderers and HUDs consume snapshots and events; they never resolve hits, scores or bot choices. A renderer
  change cannot change gameplay or replay determinism.
- **Keys never reach the browser.** `.env` holds `OPENAI_KEY`, `PRESSAGE_KEY` (double S, read under either
  spelling) and `ELEVENLABS_KEY`. All are read only by the server process.
- **No enums, no constructor parameter properties** (TypeScript `erasableSyntaxOnly`). Unused locals fail the build.
- **Do not commit or push unless asked.** The owner commits and pushes from their own terminal; this machine has
  no GitHub credentials.

## 3. Running it

```bash
npm install          # also fetches Presage's native runtime for every platform, a few hundred MB
npm run agent        # server on :8790: AI corners, phone relay, health and vitals routes
npm run dev          # game on http://localhost:5174, starts a Cloudflare quick tunnel for phones
npm test             # 251 tests
npm run build        # strict typecheck, then the production bundle
```

Other scripts: `npm run tunnel` (a standalone quick tunnel, for hosts that are not Vite), `npm run fake-phone`
(a simulated phone: `-- --slot 2 --sport golf --peak 22 --every 2500`), `npm run preview`, `npm run typecheck`.

If `npm run agent` says the port is in use, another copy is already running (often one left in a terminal
or in the background). Stop it or set `AGENT_PORT`.

Pages served by the dev server:

| Page | What it is |
|---|---|
| `/` | the game |
| `/controller.html?player=1` | the phone controller (add `&fake=1&debug=1` to drive it from a desktop) |
| `/join.html` | standalone join page with QR codes |
| `/motion.html` | motion lab: what the phone is sending, on the big screen |
| `/vitals.html` | vitals lab: camera pulse and breathing with a consent gate |
| `/environment-preview.html` | 3D environment preview used during renderer work |

Dev hooks on the game page: `window.__game`, `window.__advance(ms)`, `window.__pad` (the controller
client; `__pad.ingest(packet)` injects a phone packet), `window.__boxing` / `__bowling` / `__golf`.
Keys dispatched from scripts must be DOM `KeyboardEvent`s with `keyCode` set, or Phaser ignores them.

## 4. The games

### Boxing (`src/games/boxing/`)
Three rounds against a bot tier (rookie, pro, champ) or a sparring dummy. Health, stamina (punches, absorbed blocks and dodges spend it; it refills at 40/s in every state except the punch itself, at half that with the guard held, footwork is free, and a dodge that evades a punch pays back more than it cost; bots and AI corners never retreat, and two fighters cannot back away in the same tick), guard, slips, ducks, step in and out, knockdowns with a count, KO and
decision. Keyboard: `J` jab, `K` cross, `Space`/`S` block, `A`/`D` step, `Q`/`E` sway, `W` duck, arrows in
and out, `Esc` pause, `H` help. The renderer draws an anatomical opponent rig (`render/OpponentRig.ts`)
and first-person player arms (`render/PlayerArms.ts`); a knockdown drops the rig to the canvas.

Bot tiers live in `sim/tiers.ts`. They were lowered deliberately; the suite pins floors (a rookie must
throw more than four punches a minute, a champ must defend more than a rookie) and a ceiling raised to
match the pace (a champ under 36 punches a minute).

Pace rules, all in the sim and tested (`sim/pace.test.ts`): stamina refills at 40 per second in every
state except the punch itself (windup, active, recover) and being down, at half rate with the guard held;
footwork is free; only punches, absorbed blocks and dodges spend stamina; a dodge that evades a punch
pays back 12 for its cost of 4; between rounds the bar gains 45. Bots have no retreat mode at all, the AI
corners have no step-out action and their broke fallback is block and duck, and two fighters cannot back
away in the same tick: the one with less stamina keeps the step, ties go to the blue corner
(`resolveBackSteps` in `sim/match.ts`, deterministic and replayable). The corner service throws nothing
under 15 stamina and may script 60 percent of what it has (`server/tools.ts`). Measured over three
simulated pairings, average stamina sat between 88 and 97, no fighter dropped under 20, nobody backed
up, no punch was refused, and every fight ended by knockout in round one.

### Bowling (`src/games/bowling/`)
Ten frames against a bot. Aim phase: the release line sweeps; a tap locks it, hold and release for
power; hook taps curve the ball after the oil line. Keyboard: `A`/`D` lane, `Q`/`E` aim, arrows hook,
`Space` lock then charge, `Enter` lock, `Tab` full scoresheet. The lane marker is a blue line, thicker
once locked (`render/LaneScene.ts`).

### Golf (`src/games/golf/`)
Three procedurally generated holes with wind, water, sand, out of bounds, and a per-hole stroke cap.
Keyboard: `W`/`S` club, `A`/`D` aim, `Space` three times for power then accuracy, `Tab` map. The accuracy
sweep has a forgiving green window (`ACC_SWEET`). Holing is contact-based: the ball is in the moment it
touches the drawn cup, at any speed, no lip-out (`sim/flight.ts` `CUP_R`). The bot reads its own shot
preview and shortens any shot that would end in water or out of bounds (`sim/bot.ts`).

### Fight Night (`src/scenes/FightNightScene.ts`, `src/betting/`)
Two AI fighters, fixed-odds play-chip betting. Chips, bets and every chip movement are written to the local SQLite database through `/chips/*` (`src/betting/ledger.ts`, tables `fights`, `bets`, `chip_ledger` in `server/health.ts`); `localStorage` keeps a copy for offline play and the lobby reconciles to the server's balance. Corners can
be driven by an OpenAI model through the agent service with a short, formatted, stamina-aware prompt
(`server/service.ts`, `server/tools.ts`); without a key or service, deterministic scripted corners take over.

Chip history routes on the service: `GET /chips/summary` (balance, fights, bets won and lost, staked and
returned, net, best and worst balance, bailouts, today's net, recent fights and bets), `GET /chips/ledger`,
`POST /chips/fight` then `/chips/fight/:id/bet`, `/settle`, `/finish`, and `DELETE /chips` to reset the
stack to 500 with the history kept. The lobby (`src/scenes/FightNightScene.ts`) takes the server's balance
as the next stack and shows the record; the boxing scene ships the fight, each bet, each settled market
with its chip movements, and the final line (`src/betting/ledger.ts`). Tables `fights`, `bets` and
`chip_ledger` sit in `data/health.sqlite`; the balance is the last ledger row. A running agent needs a
restart to serve these routes after pulling.

## 5. Phone controller

### Protocol and relay (`server/controllerRelay.ts`, `src/input/controller.ts`)
Phones connect to `/controller-ws`, the game to `/controller-game-ws`, both proxied by Vite to :8790.
Two phone slots, `controller_1` and `controller_2`, plus `head_tracker` for the webcam tracker (below). Packet types: `hello`, `stick`, `motion`, `gesture`,
`action`, `activity`, `ping`/`pong`; server to phone `game_state` (sport, guard, telemetry request) and
`error`. One monotonic `seq` per controller; 256-entry event-id dedup; stick state goes stale after
250 ms. Fatal errors close the socket; a late-joining game gets the current roster replayed. The relay
stamps every data packet with the active sport, and the client only drains events for the sport a scene asks for.

### Mapping (`src/games/<sport>/keymap.ts`, merged in each scene's `update()`)
Keyboard and phone are merged every frame; the keyboard wins any field it is using.

| Phone | Boxing | Golf | Bowling |
|---|---|---|---|
| Swing | punch in any direction; speed sets damage; a wrist turn (>200 deg/s) is a cross | the shot once armed; speed sets power, accuracy perfect | the roll once armed; speed sets power |
| A | hold to guard | arm the swing (the phone sends `placeholder_primary`, then a 3 s countdown and 2 s capture window) | lock the sweeping line |
| B | duck | cancel | arm the throw |
| D-pad ←→ | slip, once per flick | aim while held | one hook step per flick |
| D-pad ↑↓ | step in / out | longer / shorter club | — |

Damage from swing speed: `punchDamageMultiplier = 0.35 + 0.65 × power` (`boxing/sim/punch.ts`); keyboard
and bot punches pass power 1, so all existing frame data holds. The guard latches on the connection, not on
stick traffic, so an idle D-pad does not drop it. A registered swing flashes green on the phone pad, on the
player's HUD corner, and in the motion lab.

### Phone pages (`src/phone/`, imported from the `treys` branch)
`Controller.tsx` reads DeviceMotion at 60 Hz through `motionProcessor.ts` (calibration, filtering, per-sport
gesture detectors), a tilt D-pad and on-screen buttons drawn as SVG glyphs with no selectable text, and a
reconnecting socket (`ControllerSocket.ts`). In boxing the detector's learned forward axis expires after
300 ms of stillness so punches may go in any direction; the immediate recoil of a punch is still rejected.
Power ceilings are set so a committed swing reads in the 40s to 60s and only an all-out one reads 100.
The phone also folds its motion into one-second epochs and measures each swing's rotation
(`src/health/activity.ts`) and reports them every five seconds as `activity` packets. Since the `treys` merge
the page wears the game's comic theme, and without motion sensors (plain HTTP, for one) the power button still
connects it in D-pad and button mode and says why the swings are missing.

### Connectivity
Phones need HTTPS for motion sensors. `npm run dev` starts a Cloudflare quick tunnel through a Vite plugin
(`scripts/tunnelPlugin.mjs`), serves the live address at `/join-config.json`, and prints it. No account: a
quick tunnel is an anonymous outbound connection with a hostname that changes every run and no uptime
guarantee. `HAP_NO_TUNNEL=1` keeps everything local. The in-game **CONNECT A PHONE** screen
(`src/scenes/ControllerScene.ts`, also on every pause screen) draws a QR per slot, shows each slot's live
claim state, and re-reads the address every four seconds. While the tunnel is starting it offers no address, so
nobody scans a page without sensors; once the tunnel has failed, is disabled or is 20 seconds late it falls back
to the same-WiFi address labelled "buttons only" (`joinConfig()` in `scripts/tunnelPlugin.mjs`). Slot security is open: anyone with the QR can claim a slot mid-match (see section 9).

### Webcam head tracker (`scripts/head_tracker.py`, merged from `treys`)
A Python process (MediaPipe face detector, OpenCV, websockets) that joins the relay directly at
`ws://127.0.0.1:8790/controller-ws` as `head_tracker`. It learns a neutral face position over 25 frames, then
sends `sway_left`, `sway_right` or `duck` when the face moves at least 0.40 (sideways) or 0.38 (down) of its own
size and faster than 1.3 or 1.1 face sizes per second, re-arming only back near the centre. `BoxingScene` drains
those actions after the keyboard and the phone and turns them into slips and a duck, with a HEAD SLIP or HEAD
DUCK burst. `npm run head-tracker` runs it; `npm run test:head-tracker` checks the gesture logic on synthetic
faces through the real detector. An agent service started before the merge refuses the slot
(`invalid_controller_id`, which the tracker prints); restart it.

## 6. Health

### Movement (`src/health/`, `server/health.ts`, `src/scenes/HealthScene.ts`)
Each match is a session: the scene starts a `HealthTracker` at creation, pumps the phone's activity reports
to the server every two seconds, and ends the session when the match finishes or the scene shuts down.
Sessions, one-second epochs and per-swing rotations go into `data/health.sqlite`. Keyboard matches record
as such, with no movement.

`energy.ts` is the model: active seconds and swings are measured; calories are an estimate, one per swing
plus a MET-based term from movement intensity at the body weight in settings (default 70 kg); range of
motion is the gyro integrated over each swing. A live badge under the HUD counts calories, swings and
active time during a match; the results line says how the session went against the daily goal.

The **HEALTH** menu tab shows today, the week strip against the 150-minute guideline, per-sport totals, a
range-of-motion trend, the last session's effort curve with a fatigue ratio, the daily goal (default 100 kcal,
up and down keys), body weight (left and right), and a two-press clear. The main menu shows today's goal
with a progress bar. Every screen carries the wellness disclaimer.

Routes: `POST /health/session`, `POST /health/session/:id/add`, `POST /health/session/:id/finish`,
`GET /health/summary?days=`, `GET /health/sessions`, `DELETE /health`.

### Camera vitals (`server/vitals.ts`, `src/lab/VitalsLab.tsx`)
Presage's SmartSpectra Node SDK runs inside the agent service, headless; it opens the laptop camera itself,
the key stays in the service, frames are never stored (the SDK sends preprocessed signal data to Presage's
physiology service). A pure reducer folds decoded metrics into pulse, breathing with a waveform, HRV, a
resting baseline from the first twelve stable readings, exertion above it and recovery over a minute, gated
on the SDK's `stable` flag and a 60 percent confidence floor. Stable readings go into the `vitals` table.

The vitals lab starts nothing until consent is ticked, shows an on-camera indicator, the SDK's own guidance
while it settles, the readings with confidence, and the phone's movement beside them. A demo source drives
the same reducer without a camera. The service refuses to load the native runtime when the OS exposes no
video device and says so; a failed start destroys the SDK instance.

Routes: `GET /vitals`, `GET /vitals/devices`, `POST /vitals/start` (`{ demo?, cameraIndex? }`),
`POST /vitals/stop`, `GET /vitals/history?minutes=`.

Facts that bound this feature: the subject must be still for about twelve seconds (lobby and round breaks,
never mid-swing); pulse and breathing are FDA-cleared on iOS and Android only, and HRV, waveforms and
expression are explicitly not; the vendor's terms call these wellness readings, not for diagnosis or treatment.
The camera path is written to the documented API and was exercised up to construction: the development
machine (a ThinkPad P14s Gen 6 AMD) exposes no video device, so no real reading has been taken yet.

## 7. Server (`server/agent.ts`)

One HTTP server on :8790 with manual WebSocket upgrade routing: `/agent/ws` for the AI corner link,
`/controller-ws` and `/controller-game-ws` for the relay, everything else destroyed. HTTP routes: `/agent/*`
(health and act), `/health/*`, `/vitals/*`, `/chips/*`. `.env` is read at start; values reach the browser never.
Vite proxies `/agent`, `^/health(/|$)`, `^/vitals(/|$)`, `^/chips(/|$)` and both socket paths to :8790; the anchors keep
the lab pages (`/vitals.html`) from being captured by the API prefix.

## 8. Verification

- `npm test`: sims, replay timing, keymaps, phone mappings, bots and tier floors, betting, renderer
  interpolation, agent execution and fallbacks, relay over real sockets, controller client, join-link
  resolution, the energy model, the phone activity tracker, the SQLite store, the vitals reducer and demo
  bridge, the boxing pace rules (`src/games/boxing/sim/pace.test.ts`), the chip tables and the ledger
  client (`server/health.test.ts`, `src/betting/ledger.test.ts`), and an end-to-end test from
  accelerometer samples to opponent damage (`test/phoneSwing.test.ts`).
- Browser checks used during development: the game at `:5174` with the dev hooks, the fake phone against the
  live relay, the motion lab's trigger-line trace, the connect screen's QR bytes compared against a fresh
  encoding, the vitals lab in demo mode.
- Cloudflare tunnel verified from the public edge: pages and both WebSocket paths through
  `*.trycloudflare.com`, phone round trip about 44 ms.
- Head tracker (at the `treys` merge): synthetic faces through MediaPipe 1.0.1 on Linux, the tracker's
  `RelayClient`, the real relay and a game socket delivered `sway_left`, `sway_right` and `duck` over one
  connection. The tracker as first merged never delivered with websockets 17.1 (see section 13).

Things never verified with real hardware: a real phone's swing thresholds (the motion lab exists for this),
a real camera reading, the head tracker's thresholds on a real webcam (this machine has none).

## 9. Open work, in priority order

1. **Real-phone validation** of the detector thresholds. Open the motion lab and see whether a natural jab
   clears the trigger line; tune `src/phone/config.ts`.
2. **Slot security.** A per-match token in the QR URL checked at `hello`, before any public demo.
3. **Real camera run** on a machine with a webcam, then decide how vitals feed play (the owner's decision:
   adapt bot difficulty from exertion, with a safe default when the camera is off).
4. **ElevenLabs announcer** for all sports: speaking lock with event priority, pre-cached common lines,
   a per-match cost ceiling. Researched in `docs/NEXT_PHASE.md`, not started.
5. **The visual fix list** (three-quarter cameras, bowling backdrop and pins, golf sky and horizon, crowd
   push-back). Only the golf green window and the HUD tier were built; boxing is still first-person.
6. **Health follow-ons from phone motion**: reaction time from a game cue to the swing, an accessibility mode
   (lower swing trigger, seated play), guided mobility drills. Steadiness at rest is stored but not shown,
   on purpose.
7. **Stable public URL** (a named tunnel under a Cloudflare account) and replay determinism for phone matches
   (record punch power beside the seed). Both deferred by the owner.
8. **Head tracker on a real webcam**: tune the distance and speed thresholds with a person rather than synthetic
   faces. The connect screen does not show the tracker's slot yet.
9. Small: the pause screen's key hints overlap on short windows; the HUD phone-punch ring lingers while the
   scene slows its tween clock.

## 10. Where things are

```
index.html, controller.html, join.html, motion.html, vitals.html   Vite entries
src/main.ts                    Phaser game, scene list, dev hooks
src/scenes/                    title, menu, mode and game select, settings, tutorial, Fight Night,
                               ControllerScene (QR), HealthScene, CreditsScene
src/games/<sport>/             Scene.ts, keymap.ts (+phone mapping), sim/, render/, hud/, tutorial.ts
src/engine3d/                  shared PlayCanvas device, camera rig, materials, textures, effects
src/input/                     keys, controller client (relay), joinLink (tunnel address)
src/health/                    energy model, phone activity tracker, game-side tracker, live badge
src/phone/                     React controller and join pages, motion processing, socket
src/lab/                       motion lab, vitals lab, Trace chart
src/agent/, src/betting/       AI corner link and executor, settings, betting book, chip ledger client
server/                        agent.ts, service and tools (AI corners), controllerRelay, health, vitals
scripts/                       tunnel plugin (+joinConfig), standalone tunnel, quickTunnel helper, fake phone,
                               head_tracker.py (webcam dodges)
test/                          end-to-end phone swing, smoke, joinConfig, head tracker (Python)
docs/                          this file, SPEC.md (code-level spec sheet, PlayCanvas guide, new-boxer recipe),
                               NEXT_PHASE.md (research and decisions), ENVIRONMENT_LAYER.md
legacy/2d/                     the archived Phaser-only pixel renderer
data/                          health.sqlite (git-ignored)
```

## 11. Decisions already taken by the owner

- Quick tunnels for now, no Durable Object.
- The announcer talks both over play and between beats.
- Vitals adapt difficulty from the signal rather than only displaying it.
- Presage key name does not matter; both spellings are read.
- Bots easier across the board; art procedural only; boxing, bowling and golf were to move to three-quarter
  cameras (not yet done).
- Quality over deadline scoping; no artificial limits on what is built.

## 12. Changes since the previous revision of this document (`36458cf`)

- **Boxing pace** (`4b10dcd`, `75d9b49`, `464acdf`): the stamina model rewritten as described in section 4.
  Why: a Fight Night screencast showed both stamina bars pinned at a sliver for a whole round, because the
  old rule refilled only an idle fighter with the guard down and drained a held guard, and both corners
  held block. Bot retreat and the corners' step-out were removed at the owner's request; the tier fields
  `retreatStamina` and `retreatTicks` no longer exist; the difficulty sliders build bot parameters without them.
- **Chips in SQLite** (`a3398d8`, `82bf868`): fights, bets and chip movements recorded through `/chips/*`,
  with the lobby reconciling to the server's balance. Verified live on a temporary port.
- **Counts** at that revision: 28 test files, 245 tests, 25 commits on `main` (now 29 and 251, see section 13). The two most recent commits may still be
  ahead of `origin/main` until the owner pushes; this machine holds no GitHub credentials.

## 13. Merged from `treys` (`eaa604f`, 2026-09-13) and follow-ups

The four `treys` commits merged with no textual conflicts; `main`'s pace, chip and docs work touched other files.
What they brought:

- **Webcam head tracker** (`23ae326`): described in section 5. The relay and `controllerInput` accept
  `head_tracker` and the `duck`, `sway_left`, `sway_right` actions.
- **Mouse** (`23ae326`): `ComicButton` and game-card hit areas fixed (they sat half a button up and to the left, so
  clicks missed), ◀ BACK on mode and game select, BACK and HELP on the pre-fight screen, clickable and draggable
  sliders, a ⏸ PAUSE button and clickable key hints on all three HUDs, and a click outside the pause or connect
  overlay closes it.
- **Knockdown count board and credits** (`c7e167c`): a centre "REFEREE COUNT" panel driven by the sim's `count`
  events, and a dedicated `credits` scene.
- **Phone controller theme** (`1980c0e`): comic retro-arcade CSS, Bangers and Outfit from Google Fonts.
- **Join prompt and sensor fallback** (`a15fea0`): FIGHT with no phone asks JOIN WITH PHONE? (`X` plays on the
  keyboard); the phone connects in D-pad and button mode when DeviceMotion is unavailable; connect-screen overlap
  fixes.

Follow-ups committed on `main` after the merge:

- `112d42b` The tracker read `ws.closed`, which websockets 14 and later removed. It threw inside the send loop, so
  the tracker reconnected every second and never delivered a dodge. Fixed, together with dropping dodges made while
  disconnected, locked sequence numbers, per-run event ids, a one-time relay refusal message, AVFoundation only on
  macOS, and `Esc` to quit.
- `fb9efbf` `treys` stopped serving the LAN address so a phone scanned during tunnel start-up would not land on an
  HTTP page, which also removed the fallback when there is no tunnel at all. `joinConfig()` keeps the first and
  restores the second once the tunnel fails, is disabled or is 20 seconds late (`test/joinConfig.test.ts`).
- `77fc829` The count board asked a downed player to tap keys or shake; the count ignores input, so the line now
  matches the sim and names the fighter in Fight Night. Head-tracker input is cleared at match start. The phone
  page's focus outline and reduced-motion rule, dropped by the restyle, are back.

After pulling: restart `npm run agent` so the relay knows `head_tracker`; Vite restarts itself on the plugin change.
