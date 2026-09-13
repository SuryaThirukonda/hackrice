# Tempo

A Phaser + PlayCanvas adaptive wellness arcade with boxing, bowling, golf, and AI-vs-AI Fight Night betting. **Tempo Session** combines a goal, a consent-first body check-in, movement-aware play, recovery, and deterministic challenge adaptation. Phaser owns the menus, HUD, input, and deterministic 120 Hz simulations; PlayCanvas renders the interactive 3D sports environments behind it.

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
| `A` | hold to guard | stop the swing meter, like `Space` | lock the sweeping line, or throw at fixed power once armed |
| `B` | duck | arm the swing and start the timer, then swing | arm the throw and start the timer, then swing |
| D-pad ←→ | slip | aim | one step of hook per flick |
| D-pad ↑↓ | step in / out | longer / shorter club | — |

The bowling aim marker is a blue line, thicker once locked. Outside boxing, `B` starts a three-second
countdown on the phone, then a two-second window in which the strongest swing counts. In a two-player
match, phone 2 plays for player 2.

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

While the tunnel is starting the connect screen offers no address, so nobody scans a link whose
sensors cannot work. If the tunnel fails, is turned off, or has not come up within 20 seconds, it
falls back to this machine's same-WiFi address and says so: a phone on that address gets the D-pad
and the buttons but not the swings, and the controller page itself explains that motion needs HTTPS.

`npm run tunnel` starts a tunnel on its own, for a production server or a host that is not Vite.

## Tempo wellness

**Tempo Session** is the primary loop: pick one sport or an adaptive mix, ready up with the phone QR and
an optional camera, play, recover, see why Tempo adjusted, and continue or review the session story. Free Play and Fight Night remain available as separate arcade modes.

The **WELLNESS** dashboard leads with active time, movement actions, activity load, and recovery. It
also shows the last session, the latest adaptation, and a weekly active-minute trend. Phone data is
reduced on-device into one-second motion summaries; raw motion samples are not stored. Sessions,
normalized motion load, usable vitals, and adaptation decisions are stored locally in
`data/health.sqlite` by the agent service. Keyboard-only matches are labelled honestly as having no
phone movement record.

Active energy is optional and secondary. When body weight is absent it is shown as **not calculated**;
when present, Tempo maps sport-specific motion load into conservative Compendium MET bands and uses
the standard MET conversion with the resting component removed. It never awards calories per swing.
All physiology and energy values are wellness estimates, not medical measurements.

## Camera vitals (Presage)

<http://localhost:5174/vitals.html> is the developer **Wellness Lab**. It shows Presage source,
validation, stability, confidence, freshness, baseline progress, normalized motion/energy inputs,
PlayerState, and the resulting adaptation. It starts nothing until the person in front of the camera
consents; a deterministic demo source exercises the same normalized pipeline without a camera.

The reading runs inside the agent service through Presage's SmartSpectra Node SDK, a native binding
that opens the laptop camera itself and runs headless. The key is `PRESSAGE_KEY` in `.env` and never
reaches the browser. Frames are not stored; the SDK sends preprocessed signal data to Presage's service.
Note that `npm install` fetches the SDK's native runtime for every platform, a few hundred megabytes.

Pulse is the MVP signal (about 12 still seconds). Breathing is opportunistic (about 30 seconds), while
HRV, arterial-pressure, and expression models are not requested and do not influence gameplay. The subject must be
still, so sensing is used only at check-in and recovery boundaries, never mid-swing. `PRESAGE_MODE`
selects `live`, `mock`, or `off`; unavailable or low-quality physiology falls back to motion and game
performance without blocking the session. These are wellness readings by the vendor's own terms, not
measurements for diagnosis or treatment.

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

## Head tracker (boxing, webcam)

`scripts/head_tracker.py` watches the player through a webcam with MediaPipe's face detector and turns a
quick, deliberate head snap into defence: down is a duck, left and right are slips. It joins the relay as a
third controller, `head_tracker`, beside the two phone slots, so the keyboard, a phone and the camera all
work in the same match.

```bash
pip install mediapipe opencv-python websockets   # MediaPipe has wheels for Apple Silicon, Linux and Windows
npm run agent                                     # the relay; restart it if it was started before this feature
npm run head-tracker                              # or: python3 scripts/head_tracker.py --camera 1
```

Hold still for the first second while it learns the neutral position. A move counts only when it is both
large (about 40% of the face's size) and fast, and the head has to come back near the centre before the
next one, so ordinary leaning does nothing. The match shows `HEAD SLIP` or `HEAD DUCK` when one arrives.
In the camera window `c` recalibrates and `q` or `Esc` quits; `--no-window` runs it headless. It talks to
`ws://127.0.0.1:8790/controller-ws` unless `--url` says otherwise. If the relay refuses it, the tracker
prints why once instead of retrying silently.

`npm run test:head-tracker` feeds synthetic faces through the real detector and checks that drift is
ignored and each snap produces the right action. Both commands download MediaPipe's face model (about
230 KB) to `~/.cache/mediapipe` the first time.

## Announcer

Every game has a spoken announcer: round, frame and hole calls, big moments, results, and a few colour lines in
quiet stretches. Every line is a preset in `src/announcer/lines.ts` and has its own committed clip in
`public/announcer/`, voiced with ElevenLabs' George voice (`JBFqnCBsd6RMkjVDRZzb`, model `eleven_turbo_v2_5`). The
game needs no key and no service to announce. Settings has ANNOUNCER, ANNOUNCER VOLUME and CAPTIONS rows, and a line
without a clip still shows as a caption.

Regenerating needs `ELEVENLABS_KEY` in `.env`. A line whose clip already matches its text, voice and model is skipped.

```bash
npm run announcer -- status                            # how many lines have a clip on disk
npm run announcer -- generate --dry-run                # the lines that would be synthesized
npm run announcer -- generate                          # synthesize missing or changed lines
npm run announcer -- generate --line win.you --force   # redo one line
```

`--group`, `--take`, `--line` and `--limit` narrow a run; `--voice` and `--model` override the defaults. Listen at
`/announcer-review.html` on the dev server. The credits screen names ElevenLabs as the source of the announcer voice.

## Controls

| Game | Keys |
|---|---|
| Boxing | `J` jab, `K` cross, `Space`/`S` block, `A`/`D` step, `Q`/`E` sway, `W` duck, `↑`/`↓` in/out |
| Boxing, player 2 | arrows step in, out and slip, `U` jab, `I`/`L` cross, `O` block, numpad too; player 1 then gives up the arrows |
| Bowling | `A`/`D` lane, `Q`/`E` aim, `←`/`→` hook, tap `Space` to lock, then hold/release for power, `Tab` sheet |
| Golf | `W`/`S` club, `A`/`D` aim, three presses of `Space` for power/accuracy, `Tab` map |
| Fight Night | `A`/`D` corner, `↑`/`↓` stake, `Enter` place, `Space` skip |
| Menus | arrows or `W`/`S`, `Enter`, `Esc`, or the mouse |

All game bindings can be changed in Settings. PlayCanvas quality can be switched between low, medium, and high there.

The mouse works throughout: buttons and game cards take a click where they are drawn, the difficulty
sliders can be clicked or dragged, every match HUD has a **PAUSE** button (clicking the key hints pauses
too), and clicking outside a pause or connect overlay closes it. Starting a match with no phone connected
first asks whether to connect one; `Enter` opens the QR codes and `X` goes straight to the keyboard. A
knocked-down fighter gets the referee's count on a board in the middle of the screen, every match ends on
a comic victory banner before the result panel, and every menu screen has a **◀ BACK** button.

## Two players

**PLAY**, then **2 PLAYERS**, opens a lobby for any of the three sports. It shows whether each player is on
the keyboard or a phone, has a **CONNECT PHONES** button, and keeps the seed and, for golf, the course.
Boxing splits the screen into two first-person views: player 1 on the left in blue gloves, player 2 on the
right in red, both fighters in the same build. Bowling and golf take turns, and each turn listens to that
player's phone when one is connected. There are no bots in a two-player match.

Boxers come in seven procedural builds, chosen by tier in single player and by persona in Fight Night; see
[`docs/boxing-models.md`](docs/boxing-models.md).

## Architecture

```text
src/main.ts                 Phaser game and scene flow
src/engine3d/               shared PlayCanvas device, cameras, lighting and effects
src/games/*/sim/            deterministic 120 Hz gameplay and bots
src/games/*/render/         PlayCanvas ring, lane, course and character models
src/games/*/hud/            score, health, meters, help and results
src/scenes/                 title, menus, Tempo loop, wellness, settings, tutorial and Fight Night
src/wellness/               normalized motion/physiology, PlayerState, planning and adaptation
src/agent/ + server/        browser agent link, server-side OpenAI service, phone relay
src/phone/                  React controller and join pages (the only React in the repo)
src/lab/                    motion lab: what the phone sends, on the big screen
scripts/                    tunnel plugin, standalone tunnel, fake phone, announcer CLI
src/betting/                fixed-odds play-chip book
src/announcer/              preset announcer lines, event maps, speaking rules, voice player, review page
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

Development builds expose `window.__game`, `window.__advance(ms)`, `window.__boxing` / `__bowling` / `__golf`, and `window.__announcer` (the announcer's call log, `say(cue)`, and each line's audio status) for browser-driven verification. `?voice=captions` forces the announcer into captions-only mode.
