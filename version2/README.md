# version2: The House Always Plays (comic Phaser shell + PlayCanvas 3D games)

A standalone browser game platform: a comic-book Phaser front end (menus, tutorial, HUD, betting) with three-quarter 3D games rendered by PlayCanvas on a canvas behind it. Every game has a deterministic simulation that is the physics authority; the 3D layer only renders it. Player-vs-bot play never touches the network. Fight Night pits two LLM agents against each other through a small Node service that keeps the OpenAI key server-side, and you bet play chips on them.

## Run

```bash
cd version2 && npm install
npm run dev      # game on http://localhost:5174
npm run agent    # Fight Night agent service on :8790 (reads ../.env or ./.env, see .env.example)
npm test         # vitest: sims, keymaps, executor, betting, agent service, smoke
npm run build    # tsc --noEmit + vite build
```

Without the agent service (or without a key) Fight Night still works: the service, or the browser when the service is unreachable, falls back to scripted deterministic corners.

## Games and controls (keyboard only, rebindable in Settings)

| Game | Keys |
|---|---|
| Boxing | `J` left jab, `K` right cross, `Space`/`S` block (hold), `A`/`D` step left/right, `Q`/`E` sway-dodge, `W` duck, `↑`/`↓` step in/out, `Esc` pause, `H` help |
| Bowling | `A`/`D` lane position, `Q`/`E` aim angle, `←`/`→` hook; the aim path sweeps on its own: tap `Space` to lock it, then hold `Space` and release for power, `Tab` full scoresheet, `Esc` pause |
| Golf | course chosen on the pre-fight screen; `W`/`S` club, `A`/`D` aim, `Space` three-press swing (start, power, accuracy: a stop inside the green window flies straight), `Tab` top view, `Esc` pause |
| Fight Night | `A`/`D` corner, `↑`/`↓` stake, `Enter` place, `Space` skip the window, `Esc` pause |
| Menus | arrows or `W`/`S`, `Enter`, `Esc`, `Tab` switches tutorial game |

## How the pieces fit

```
src/
  main.ts                 Phaser.Game (transparent, RESIZE), scene list, resize hook, dev hooks
  theme.ts                comic palette, fonts, game list
  ui/widgets.ts           ComicBackdrop, ComicButton, comicPanel, MenuNav, actionBurst
  scenes/                 Boot, Title, MainMenu, ModeSelect, GameSelect, PreFight (sliders+seed),
                          Tutorial (pages + TRY IT), Settings (sound, key rebinding), FightNight (lobby), Placeholder
  engine3d/               Engine3D singleton (PlayCanvas AppBase on a canvas behind Phaser, manual render),
                          materials (flat + ink outline), primitives (inverted-hull outlines, IK), springs, CameraRig
  input/keys.ts           KeyState: held keys and press edges, fed by window key events
  games/boxing/
    sim/                  deterministic 120 Hz match: types, constants, physics, punch resolution, match phases, bot, tiers
    render/               RingScene, OpponentRig, PlayerArms, poses (per-state targets + bezier punches), BoxingWorld, interp
    hud/BoxingHud.ts      bars, timer, cards, bursts, flash, result/pause panels, bet panel, taunt bubbles
    keymap.ts tutorial.ts BoxingScene.ts
  games/bowling/          sim (lane, 2D disc physics, scoring, bot), render, hud, keymap, tutorial, BowlingScene
  games/golf/             sim (holes as data, calibrated clubs, flight, bounce/roll, hazards, bot), render, hud, keymap, tutorial, GolfScene
  agent/                  sliders (difficulty -> bot params, settings), executor (plays agent scripts on the sim clock), AgentLink
  betting/book.ts         fixed odds, stakes, settlement, ledger conservation, bailout
server/                   agent.ts (HTTP + WS), service.ts (OpenAI Responses API with function tools), tools.ts, summarize.ts, fallback.ts
test/smoke.test.ts        one bot-vs-bot game per sport + slider monotonicity
```

## Boxing rules (auto-target model)

A punch thrown in reach always lands unless the defender is mid-dodge (sway or duck, invulnerable for the first 22 of 30 ticks, 54-tick cooldown) or is holding a guard. A guard auto-blocks: 15 % damage, but the blocker pays stamina per punch; at zero stamina the guard breaks (stagger). Stepping in adds momentum: up to +50 % damage and +60 % knockback. Knockback is an impulse that decays with friction; ropes bound the ring; fighters never overlap. Three 90 s rounds, knockdowns at 60 and 30 health, count to ten, KO at zero or three knockdowns in a round, decision by damage dealt. Everything is integer-tick deterministic: the same seed and the same inputs replay the same fight.

## Rendering stack (PlayCanvas, procedural, no assets)

- Cameras: boxing uses a three-quarter chase camera (`engine3d/ChaseRig.ts`: soft springs behind and above the player's shoulder, offset to the right, FOV 42, shake on hits, a push-in and side swing on knockdowns); Fight Night keeps the orbiting ringside camera on the same rig. Bowling sits at chest height behind the foul line, off-axis, FOV 36 while aiming (44 chasing the ball, 40 on the pin deck). Golf sits at shoulder height behind the ball, off-axis, FOV 48.
- Lights: one warm directional key light plus flat ambient (no fill, rim, environment lighting or particle loops: the cheapest lighting the toon materials read); ACES tone mapping; linear fog per world tinted to the backdrop (bowling 14 to 60 m; golf per theme, about 60 to 700 m, so distance fades toward the sky).
- Quality (Settings, 3D QUALITY): medium (default) and low render straight to the canvas with no shadows and no post pass; high adds 1K key-light shadows and a vignette/grading pass. No bloom, SSAO or depth of field anywhere. Pixel ratio is always 1.
- Draw calls: static scenery is batched per material (`engine3d/primitives.ts: setDefaultBatch`, untextured materials are shared from a cache), including the bowling hall, each golf hole's props and ridge cards, and the ring furniture; the two boxer rigs use dynamic batch groups. Bowling went from about 570 draws with a shadow pass to about 240 without one.
- Dressing: sagging ropes, turnbuckle pads, apron band, floor decals, a warm spotlight pool on a light canvas, ringside desk, stools and crew silhouettes, a dark billboard crowd pushed back behind the apron (idle bob, hops on landed punches, knockdowns, KOs and bells); bowling alley with neighbour lanes, a painted backdrop (`textures.ts: backdropTex`, neon sign and masking band), ceiling, neon wall strips, pins drawn 1.3x with two stripes and blob shadows, a bright centre pin deck; golf courses with a gradient sky dome, sun and cloud cards, three rings of ridge silhouettes on the horizon, mowing stripes, dirt patches, clustered trees with ground shadows and themed props. Static ring furniture is batched into a handful of draw calls.
- Particles (`engine3d/fx.ts`): sweat on hits, dust on knockdowns, sparks on guard breaks, confetti on wins and strikes, pin sparks.
- Golf courses (`games/golf/sim/courses.ts`): Meadow Links, Desert Canyon, Neon Night, three holes each, picked on the pre-fight screen.

## Stamina and bot behaviour (boxing)

- A full bar is about 10 jabs or 6 crosses; holding the guard costs a net 1 per second and each blocked punch its block cost; at zero, punches are refused (the slim ten-segment stamina bar under the health bar flashes red) and the guard breaks. Idle regen 8 per second, 3 while guarding.
- The bot retreats only for a bounded breather with a cooldown, guards against windups, and closes to jab reach; punch cadence per tier is pinned by tests (rookie about 5 to 9 per minute).

## Fight Night agents

- The browser sends a compact state summary per corner; the service calls the model with one tiny function tool (`act`: up to six timed steps for the next 2.5 s, plus an optional taunt) with reasoning off, 3 s budget. Between rounds it makes one `strategy` call with reasoning effort `high`; the plan is fed back into the fast calls.
- Latency is symmetric and shown per corner. If a script is late the local deterministic bot fills in, so the fight never stalls. Malformed or slow answers fall back to scripted corners.
- Model id comes from `AGENT_MODEL` (default `gpt-5.6-luna`, verified at startup, automatic fallback to `gpt-5-mini`).

## Tests

- Boxing sim: replay determinism, impact timing, auto-target, dodge windows and cooldown, auto-block and guard break, momentum, knockback decay, rope and body fuzz, stagger vs hitstun, stamina and fatigue, knockdown/KO, rounds and decision, bot tiers, 20 bot-vs-bot matches with invariants.
- Keymaps: every binding, edges vs held, cancellation, rebinding, help table coverage.
- Executor, betting book, agent service (fake client: valid, malformed, timeout, model fallback, no key), bowling and golf sims, smoke.

## Dev hooks (development build only)

The in-app preview pane throttles timers, so `main.ts` uses a setTimeout ticker in dev and exposes `window.__game` and `window.__advance(ms)` (steps the game clock synchronously, tweens included). Scenes expose `window.__boxing` / `__bowling` / `__golf` with `getEventLog()`. Keys in that pane must be dispatched as DOM events, for example `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j' }))`.
