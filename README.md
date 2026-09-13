# Tempo

A Phaser + PlayCanvas arcade sports collection with boxing, bowling, golf, and AI-vs-AI Fight Night betting. Phaser owns the menus, HUD, input, and deterministic 120 Hz simulations; PlayCanvas renders the interactive 3D sports environments behind it.

## Run

```bash
npm install
npm run dev      # game on http://localhost:5174
npm run agent    # Fight Night agent service and phone relay on :8790 (reads .env)
npm test
npm run build
```

Without the agent service or an API key, Fight Night uses deterministic scripted corners. With the
service up, every Fight Night fight, bet and chip movement is written to the local SQLite database
(`data/health.sqlite`), the lobby shows the running record, and the same chip stack follows you across
reloads and browsers. `DELETE /chips` resets the stack to 500 and keeps the history.

## Phone controller

A phone plays all three sports alongside the keyboard. Both inputs are merged every frame, so either
can be used at any moment, and a swing that registers flashes green on the phone, on the player's
corner of the screen, and in the motion lab.

| Phone | Boxing | Golf | Bowling |
|---|---|---|---|
| Swing | punch, any direction; speed sets damage, a wrist turn makes it a cross | the shot, once armed; speed sets power, accuracy is perfect | the roll, once armed; speed sets power |
| `A` | hold to guard | arm the swing | lock the sweeping line |
| `B` | duck | cancel the arm | arm the throw |
| D-pad ←→ | slip | aim | one step of hook per flick |
| D-pad ↑↓ | step in / out | longer / shorter club | — |

The bowling aim marker is a blue line, thicker once locked.

A phone needs HTTPS, because browsers only expose the motion sensors on a secure origin. `npm run dev`
therefore starts a Cloudflare quick tunnel by itself and prints the address next to the local one. No
account, no deploy: it is an outbound connection that dies with the server. The same tunnel carries
the WebSocket, so the phone opens a `wss://` socket from an `https://` page and nothing is blocked as
mixed content. Set `HAP_NO_TUNNEL=1` to keep the server entirely local.

```bash
npm run agent     # relay on :8790
npm run dev       # game, phone pages, and the phone tunnel
```

The QR codes live inside the game: **CONNECT A PHONE** on the main menu, and **CONNECT PHONE** on
every pause screen. It shows one code per controller slot, the address in plain text for a phone that
will not scan, and a chip beside each slot that turns green the moment a phone claims it. The address
is re-read every few seconds, so a restarted tunnel redraws the codes on its own. Scan, tap Connect,
then Calibrate. There is also a standalone join page at <http://localhost:5174/join.html>.

If the tunnel cannot start, the connect screen falls back to this machine's same-WiFi address and
says so: a phone on that address gets the D-pad and the buttons, but not the swings.

`npm run tunnel` starts a tunnel on its own, for a production server or a host that is not Vite.

## Health

The main menu's **HEALTH** tab shows what the last week of play did: active minutes, an estimated
calorie figure, swing counts, a per-sport breakdown, a range-of-motion trend across sessions, and the
last session's effort curve. It all comes from the phone's motion sensors: the phone folds its 60 Hz
readings into one-second summaries and measures each swing's rotation, and sends a few numbers every
five seconds. Each match becomes a session in a local SQLite database (`data/health.sqlite`, kept by
the agent service and never shared). Keyboard-only matches are recorded as such, with no movement.

Active minutes and swings are measured. Calories use the standard MET-based formula with a body weight
set on the tab (70 kg by default) and are estimates. Nothing here is a medical measurement.

## Camera vitals (Presage)

<http://localhost:5174/vitals.html> is a test page for the camera reading: pulse rate, breathing rate
with a live waveform, heart-rate variability labelled as uncleared, a resting baseline with exertion
and recovery derived from it, and the phone's movement beside them. It starts nothing until the person
in front of the camera ticks the consent box; a demo source runs the same pipeline without a camera.

The reading runs inside the agent service through Presage's SmartSpectra Node SDK, a native binding
that opens the laptop camera itself and runs headless. The key is `PRESSAGE_KEY` in `.env` and never
reaches the browser. Frames are not stored; the SDK sends preprocessed signal data to Presage's service.
Note that `npm install` fetches the SDK's native runtime for every platform, a few hundred megabytes.

The subject must be still, so this is for the lobby and the breaks between rounds, never mid-swing.
These are wellness readings by the vendor's own terms, not measurements for diagnosis or treatment.

## Testing the controller

<http://localhost:5174/motion.html> is a motion lab for the big screen, because you cannot read a
phone while swinging it. It listens on the game side of the relay and shows the live acceleration
trace against the detector's own trigger threshold, the rotation that decides jab against cross, the
D-pad position, and a log of every gesture with the move it becomes in the match. It asks connected
phones to stream raw motion by itself, and switching sport there switches the phone's detector too.

`npm run fake-phone` plays the part of a phone from the laptop: it runs the real motion processor over
synthesised swings and puts the packets on the real relay socket, so the lab, the connect screen and a
live match can all be exercised without a handset.

```bash
npm run fake-phone -- --slot 2 --sport golf --peak 22 --every 2500
```

`/controller.html?player=1&fake=1&debug=1` opens the controller page itself with synthetic motion
buttons, for checking the phone UI in a desktop browser.

## MediaPipe Head Tracker (Boxing)

A Python-based MediaPipe Face Detector tracks webcam head position in real time and sends duck and slip commands to the Boxing match via the WebSocket relay:

```bash
# Install dependencies if needed:
pip install mediapipe opencv-python websockets

# Run the tracker:
npm run head-tracker
# or: python3 scripts/head_tracker.py
```

Controls via head movements:
- **Duck**: Move head downward
- **Slip Left**: Sway head to the left
- **Slip Right**: Sway head to the right
- Press `c` on the camera HUD to recalibrate center neutral position; `q` or `Esc` to quit.


## Controls

| Game | Keys |
|---|---|
| Boxing | `J` jab, `K` cross, `Space`/`S` block, `A`/`D` step, `Q`/`E` sway, `W` duck, `↑`/`↓` in/out |
| Bowling | `A`/`D` lane, `Q`/`E` aim, `←`/`→` hook, tap `Space` to lock, then hold/release for power, `Tab` sheet |
| Golf | `W`/`S` club, `A`/`D` aim, three presses of `Space` for power/accuracy, `Tab` map |
| Fight Night | `A`/`D` corner, `↑`/`↓` stake, `Enter` place, `Space` skip |
| Menus | arrows or `W`/`S`, `Enter`, `Esc` |

All game bindings can be changed in Settings. PlayCanvas quality can be switched between low, medium, and high there.

## Architecture

```text
src/main.ts                 Phaser game and scene flow
src/engine3d/               shared PlayCanvas device, cameras, lighting and effects
src/games/*/sim/            deterministic 120 Hz gameplay and bots
src/games/*/render/         PlayCanvas ring, lane, course and character models
src/games/*/hud/            score, health, meters, help and results
src/scenes/                 title, menus, settings, tutorial and Fight Night
src/agent/ + server/        browser agent link, server-side OpenAI service, phone relay
src/phone/                  React controller and join pages (the only React in the repo)
src/lab/                    motion lab: what the phone sends, on the big screen
scripts/                    tunnel plugin, standalone tunnel, fake phone
src/betting/                fixed-odds play-chip book
legacy/2d/                  archived Phaser-only pixel renderer and art
```

The simulation is the authority. Renderers consume snapshots and events; they never resolve hits, contacts, scores, hazards, or bot choices. A renderer replacement therefore cannot change replay determinism or game physics.

The code-level reference (every module and export, the PlayCanvas toolkit and its rules, and the recipe for adding new boxer looks) is [`docs/SPEC.md`](docs/SPEC.md).

## 3D renderer

- A shared PlayCanvas canvas sits behind Phaser's transparent UI canvas.
- Boxing includes the refined arena, opponent rig, first-person player arms, ringside Fight Night camera, and impact effects from `gauravbranch`.
- Bowling includes the refined alley, physical pins and ball, aim path, audience, lighting, and lane environment from `gauravbranch`.
- Golf includes the refined procedural course, water, terrain materials, props, ball tracking, and aim/flight/top cameras from `gauravbranch`.
- Low quality disables post-processing and shadows; medium is the laptop default; high enables the full post stack and larger shadows.

The superseded 2D implementation remains available under [`legacy/2d`](legacy/2d/README.md), including its generated pixel assets and migration notes.

## Verification

`npm test` covers deterministic sims, replay timing, keymaps, bots, betting, renderer interpolation, agent execution/service fallbacks, and smoke matches. `npm run build` performs strict TypeScript checking before the production Vite build.

Development builds expose `window.__game`, `window.__advance(ms)`, and `window.__boxing` / `__bowling` / `__golf` for browser-driven verification.
