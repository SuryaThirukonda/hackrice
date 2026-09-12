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

Without the agent service or an API key, Fight Night uses deterministic scripted corners.

## Phone controller

A phone can play boxing alongside the keyboard: swing in any direction to punch, with damage scaled
by swing speed and a wrist turn making it a cross; hold `A` to keep the guard up and release to drop
it; `B` ducks; D-pad left/right slips and up/down steps in and out. Both inputs are merged every
frame, so either can be used at any time. A swing that registers flashes green on the phone, on the
player's corner of the screen, and in the motion lab. Bowling and golf are keyboard-only so far; the
transport and the relay already carry their sport stamp.

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
