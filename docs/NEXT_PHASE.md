# Next phase: phone controller, voice announcer, Presage health monitoring

Queued after the boxing work.

**Status: steps 1 and 2 are done.** The boxing controller transport and mapping are verified over real
sockets; the phone pages are imported from `origin/treys` into `src/phone/`; and the public HTTPS path is a
Cloudflare quick tunnel driven by `npm run tunnel`, verified end to end against a live tunnel. Bowling, golf,
the announcer and Presage are not started. Research for all of them is complete and is summarised below.

## Order

1. **Phone controller** (boxing first, then bowling and golf)
2. **Public HTTPS endpoint** so phones can reach the relay (quick tunnel — done)
3. **ElevenLabs voice announcer** for all three sports
4. **Presage camera-based health monitoring** during play

---

## 0. Blockers and facts to settle first

- **Key names.** The root `.env` holds `OPENAI_KEY`, `ELEVENLABS_KEY` and `PRESSAGE_KEY` (double S). Read either spelling of the Presage key. All three stay server-side: none may reach the browser.
- **The PlayCanvas merge is on `origin/main`.** Commits `e5a0782` (2D checkpoint) and `7fbadc6` (PlayCanvas import from gauravbranch) are pushed. Note that pushing from this machine fails: `credential.helper=libsecret` is configured but the helper is not installed, and there is no `gh`, SSH key or token.
- **`origin/treys` is the controller branch.** Reviewed in `docs/CONTROLLER_MERGE.md`. It forked before the repo was restructured, so its paths are `web/src/controller/*` and `godot/*`, neither of which exists in the current root layout.
- **`origin/gauravbranch` already ported the relay to this app** as `version2/src/input/controller.ts` plus `controller.test.ts`, and added a `/controller-game-ws` Vite proxy. That port was deliberately not imported. It is the natural starting point and should be re-read before writing anything new.

## 1. Phone controller

### Done (boxing)

| Piece | Where |
|---|---|
| WebSocket relay, two controller slots | `server/controllerRelay.ts` |
| Relay mounted beside the agent service on :8790 | `server/agent.ts` (switched to `noServer` + manual upgrade routing; the old `{ server, path }` form rejected every other path with a 400) |
| Dev proxies for both socket paths | `vite.config.ts`: `/controller-ws` (phone) and `/controller-game-ws` (game) |
| Relay client: latest-state stick, exactly-once event queue | `src/input/controller.ts` |
| Boxing mapping | `src/games/boxing/keymap.ts` → `controllerBoxingCommand` |
| Keyboard + phone merged per frame | `src/games/boxing/BoxingScene.ts` `update()` |
| Swing speed → damage | `src/games/boxing/sim/punch.ts` → `punchDamageMultiplier` = `0.35 + 0.65 * power` |

Protocol gaps found in the imported relay and fixed: no hello timeout, fatal errors never closed the socket,
and one socket could steal the other controller's slot.

Verified live, phone socket through the Vite proxy into a running match: a power-95 swing became a cross with
damage `12 × (0.35 + 0.65×0.95) × 0.15 = 1.7415` blocked; a power-12 swing became a jab; A held the guard
across idle frames and released on command; B ducked; the D-pad slipped left, did not repeat while held,
re-armed at centre, then slipped right.

Tests: `server/controllerRelay.test.ts` (9 end-to-end socket tests), `src/input/controller.test.ts` (5),
`src/games/boxing/keymap.test.ts` (6 mapping tests). 162 total, all passing.

**Controls as shipped.** A is a hold on the phone (`block_start` on press, `block_end` on release; no
timer or cooldown on the phone since the sim charges stamina for a held guard). B is a duck (still
`emergency_power` on the wire, and the old +10 % power boost is gone: the game never honoured it). The
detector's learned forward axis now expires after 300 ms of stillness, so a punch may go in any
direction; the immediate recoil of a punch is still rejected. A swing that registers flashes green on
the phone pad, on the player's corner of the boxing HUD, and in the motion lab.

**One design note worth keeping:** the guard latch keys off the controller CONNECTION, not off stick traffic.
Keying it off stick freshness (the original import) meant the guard silently dropped whenever the player was
not touching the D-pad.

### Still to do
- The phone page itself. `origin/treys` has it at `web/src/controller/*`, but it is React and this root app has
  no React, no JSX config and no `@vitejs/plugin-react`. Either add React for that one route, or port the page
  to plain TypeScript. `config.ts`, `motionProcessor.ts`, `tiltStick.ts`, `actions.ts` and `ControllerSocket.ts`
  are dependency-free and move across unchanged; only `Controller.tsx` and `Join.tsx` are React.
- ~~A join page with a QR code built from the live quick-tunnel origin.~~ Done twice over: the
  standalone page (`src/phone/Join.tsx`) and an in-game screen (`src/scenes/ControllerScene.ts`,
  reached from the main menu and from every pause screen), both fed by `scripts/tunnel.mjs` through
  `src/input/joinLink.ts`. The in-game screen also shows each slot's live claim state and warns when
  the relay itself is unreachable.
- ~~Bowling and golf mappings.~~ Done. Note the phone's own flow outside boxing: A sends `placeholder_primary`,
  runs a three-second countdown, then opens a two-second capture window and publishes the best swing in it,
  so the game arms on that action and the swing arrives up to five seconds later. In bowling B arms the
  throw even during the capture window; in golf B cancels. Power ceilings were raised on both swing sports
  so a committed swing reads in the 40s to 60s and only an all-out one reads 100. Golf: D-pad aims and changes club, A arms, the swing sets power with
  perfect accuracy (`SwingMeter.arm/fromSwing`, both paths end in `done` and fire through `fire()`). Bowling:
  D-pad flicks add hook, A locks the sweep, B arms, the swing releases with its power. The lane marker is a
  blue line. Bot tiers were lowered across all three games, inside the floors the suites pin (a rookie must
  still throw, a bowling champ must still average 150 and release near centre).

### Damage from swing speed: resolved

### What exists to reuse (`origin/treys`)
The phone side is complete and tested: `web/src/controller/` holds the DeviceMotion capture, an EMA filter, per-sport gesture detectors, a tilt stick, an on-screen D-pad with A/B buttons, and a reconnecting WebSocket client with sequence numbers and duplicate suppression. The protocol is documented in `godot/README.md` and reviewed in `docs/CONTROLLER_MERGE.md`: `hello`, `stick`, `gesture`, `action`, `ping`, and a server-to-phone `game_state`.

The only receiver is a Godot autoload (`godot/scripts/controller_manager.gd`). That must be ported to TypeScript; the GDScript is a clean specification for it.

### Control mapping requested
| Input | Boxing | Bowling | Golf |
|---|---|---|---|
| Swing | punch, damage scaled by swing speed | roll, power from swing speed | shot, power from swing speed |
| A | block | lock aim / start roll | lock aim / start swing |
| B | dodge | cancel | cancel |
| D-pad left/right | duck left / duck right | lane position | aim |
| D-pad up/down | step in / out | hook | club |

### Damage from swing speed: the hard part
The simulation is the physics authority and is pinned by 142 tests. Punch damage currently comes only from frame data and momentum. `gauravbranch` already solved this by adding an optional `punchPower` to `Command` and `Fighter` and multiplying damage by `0.35 + 0.65 * power`. That approach keeps keyboard and bot punches at full power, so existing tests stay valid.

Implemented. Keyboard and bot punches pass `power = 1`, so every existing frame value, bot tier and replay test
is unchanged and all 162 tests still pass.

**Replay determinism is still open.** A phone-driven match is not reproducible from its seed, because the swing
power is external input. Recording each punch's power alongside the seed would fix it. Not needed for play, but
it must be settled before anyone relies on replaying a controller match.

**Swing calibration is untested on a real phone.** `origin/treys` commit `9ab22c5` retuned the boxing detector
hard (start acceleration 7 → 3.8, power ceiling 36 → 20, rotation weight 0.22 → 0). Those numbers have never
been checked against actual swings, and they decide how a real punch feels.

### Testing before implementation
- Port the Godot two-client integration test (`godot/tests/controller_ui.gd`): two sockets, hello acknowledgement, sport broadcast, D-pad movement and release, block toggle.
- Add a headless relay test: malformed packets, stale sequence numbers, duplicate event ids, an occupied controller slot, and a dropped socket mid-match.
- Verify keyboard and controller can drive the same match without fighting each other for control.

## 2. Public HTTPS endpoint — DONE (quick tunnel)

**What ships:** one Cloudflare quick tunnel in front of the Vite dev server, started by `npm run tunnel`
(`scripts/tunnel.mjs`, binary from the `cloudflared` dev dependency). Nothing is deployed to Cloudflare's
edge: no Worker, no Durable Object, no account, no `wrangler login`. A quick tunnel is an outbound
connection from this machine that Cloudflare gives a throwaway `*.trycloudflare.com` hostname, so it needs
no credentials and dies with the process.

```
phone ──https──▶ *.trycloudflare.com ──▶ vite :5174 ──proxy──▶ agent service :8790 ──▶ ControllerRelay
```

Three reasons the tunnel points at Vite (5174) and not at the relay (8790):

1. **HTTPS is mandatory.** iOS refuses `DeviceMotion` permission on plain HTTP, so the controller page
   cannot read the accelerometer at all over a LAN address.
2. **One origin, no mixed content.** The phone builds its socket URL as
   `wss://${location.host}/controller-ws` (`src/phone/ControllerSocket.ts`). Serving the page and the
   socket from the same origin means an HTTPS page opens a WSS socket, which is the only combination a
   browser allows. Vite proxies `/controller-ws` and `/controller-game-ws` through to 8790.
3. **One tunnel instead of two.** A second tunnel for the socket would need its own hostname baked into
   the page, and would be mixed-content anyway.

**The moving-hostname problem is solved by a file, not a fixed URL.** A quick tunnel is assigned a new
hostname every restart, so it cannot be baked into a build. `scripts/tunnel.mjs` scrapes the hostname
cloudflared prints, writes `public/join-config.json`, and deletes it on exit. `src/phone/Join.tsx` polls
that file every 5 s and rebuilds its QR codes, and falls back to `location.origin` when the join page is
itself opened through the tunnel. A pasted address still overrides both.

Verified end to end against a live tunnel: `/`, `/join.html`, `/controller.html` and `/join-config.json`
all 200; `wss://<tunnel>/controller-ws` acknowledged a hello with the active sport and answered ping with
pong; `wss://<tunnel>/controller-game-ws` received the roster, a power-91 gesture and stick traffic with
the boxing sport stamped on. The controller page itself reached CONNECTED, MOTION ENABLED and CALIBRATED
over the tunnel at a **44 ms median round trip**, and three synthetic swings arrived as jab / cross / jab
(the middle one carried `peakRotation` 293, over the 200 threshold in `phonePunchKind`). On stopping the
tunnel, `public/join-config.json` was removed as designed.

**Still open, and both matter before a public demo:**

- **Anyone with the link can claim a controller slot.** The relay accepts any socket that sends a valid
  hello, so a stranger who sees the QR on a projector can take a slot mid-match. A per-match token in the
  QR URL, checked in `hello`, is the fix.
- **No stable link.** A quick tunnel is per-run, so a printed QR code is dead the moment the laptop
  restarts. A Durable Object gives a permanent URL and removes the laptop dependency; the user deferred
  it for this phase.

`vite preview` now carries the same proxy as `vite dev`, so a production build behind the tunnel reaches
the relay too.

## 3. ElevenLabs voice announcer

`origin/treys` already added a working pattern on the old backend: `backend/app/voice/commentator.py` generates a short line with OpenAI and synthesizes it through ElevenLabs with an on-disk MP3 cache, degrading to deterministic text when either key is missing. That backend no longer exists in this repo, so the same shape needs rebuilding inside the Node agent service.

Research and decide:
- **Latency budget.** A sports announcer must react within about a second of the event or it feels wrong. Measure the real round trip for a short line before designing the trigger rules.
- **Caching.** Most lines repeat (knockdown, strike, birdie). Pre-synthesize and cache the common ones at startup; only generate live for unusual events.
- **Trigger rules per sport.** Boxing: knockdown, KO, guard break, round bell. Bowling: strike, spare, gutter, turkey. Golf: birdie, water, holed putt. Rate-limit so it does not talk over itself.
- **Cost.** Every line is a paid synthesis. Decide a per-match ceiling.
- The browser must never see `ELEVENLABS_KEY`; audio has to be served from the agent service.

## 4. Presage health monitoring

This is the item needing the most research, and the most care.

Presage measures physiological signals from a camera feed. Before any implementation:
- **Confirm what the SDK actually is.** Find the real product behind `PRESSAGE_KEY`, its API surface, whether it runs in the browser or server-side, what it needs (frame rate, resolution, lighting, distance), and its licence terms.
- **Confirm what it actually measures** and with what stated accuracy. Do not present any output as a medical reading.
- **Camera consent is mandatory and explicit.** A game that silently turns on a camera to infer health signals is not acceptable. Needs a clear opt-in before the camera starts, a visible indicator while it is on, an easy way to stop, and a plain statement of what is measured and where it goes.
- **Decide data handling.** Whether frames leave the device, whether anything is stored, and for how long. Prefer processing frames locally and keeping only derived numbers.
- **Decide what it changes in the game.** The original concept adapted difficulty to player state. Adapting difficulty from an inferred health signal is a different claim from showing the player a readout. Pick one and be explicit.
- Plan a fallback: the game must be fully playable with the camera off.

**Recommendation:** treat this as a demo feature with an explicit consent gate and an on-screen readout, not as a health diagnosis, unless the licence and accuracy data support a stronger claim.

## 5. Decisions taken

These were answered by the user and are now binding for this phase.

| Question | Decision |
|---|---|
| Stable deployed WebSocket URL, or quick tunnels? | **Quick tunnels for now.** No Durable Object work this phase. The join page must therefore read the current tunnel origin at runtime rather than baking it in. |
| Does the announcer talk over gameplay, or only between beats? | **Both.** It reacts live during play and also fills the gaps, so de-duplication and a speaking-lock matter more than they would otherwise. |
| Presage: adapt difficulty, or only display the signal? | **Adapt difficulty from the signal.** The reading feeds the bot parameters, not just a readout. |
| Is `PRESSAGE_KEY` the intended spelling? | Name does not matter. **Read whichever of `PRESSAGE_KEY` / `PRESAGE_KEY` is present** and make it work. |

Consequences worth stating:

- Quick tunnels change URL on every restart, so the QR code has to be generated from a value the page fetches at runtime. `origin/treys` already solved this with a `join-config.json`.
- "Both" for the announcer means a single speaking lock plus an event priority: a knockdown must be able to interrupt idle chatter, and idle chatter must never interrupt a knockdown.
- Adapting difficulty from a physiological signal makes the signal part of the gameplay loop, so it needs a defined safe default for when the camera is off, the reading is stale, or the SDK fails. The game must play identically well with no camera.
