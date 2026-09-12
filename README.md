# The House Always Plays

A Phaser 3 arcade sports collection with boxing, bowling, golf, and AI-vs-AI Fight Night betting. The presentation is a 384×216-inspired pixel-art layer scaled by Phaser with nearest-neighbour rendering. Every game still runs its deterministic 120 Hz simulation independently of rendering.

## Run

```bash
npm install
npm run dev      # game on http://localhost:5174
npm run agent    # optional Fight Night agent service on :8790 (reads .env)
npm test
npm run build
```

Without the agent service or an API key, Fight Night uses deterministic scripted corners.

## Controls

| Game | Keys |
|---|---|
| Boxing | `J` jab, `K` cross, `Space`/`S` block, `A`/`D` step, `Q`/`E` sway, `W` duck, `↑`/`↓` in/out |
| Bowling | `A`/`D` lane, `Q`/`E` aim, `←`/`→` hook, tap `Space` to lock, then hold/release for power, `Tab` sheet |
| Golf | `W`/`S` club, `A`/`D` aim, three presses of `Space` for power/accuracy, `Tab` map |
| Fight Night | `A`/`D` corner, `↑`/`↓` stake, `Enter` place, `Space` skip |
| Menus | arrows or `W`/`S`, `Enter`, `Esc` |

All game bindings can be changed in Settings. CRT scanlines can also be toggled there.

## Architecture

```text
src/main.ts                 Phaser game and scene flow
src/retro/                  low-resolution stage, palette, projections and tests
src/games/*/sim/            deterministic 120 Hz gameplay and bots
src/games/*/render/         Phaser-only pixel renderers driven by snapshots
src/games/*/hud/            score, health, meters, help and results
src/scenes/                 title, menus, settings, tutorial and Fight Night
src/agent/ + server/        browser agent link and server-side OpenAI service
src/betting/                fixed-odds play-chip book
public/art/                 generated, quantized 384×216 background plates
```

The simulation is the authority. Renderers consume snapshots and events; they never resolve hits, contacts, scores, hazards, or bot choices. A renderer replacement therefore cannot change replay determinism or game physics.

## Pixel renderer

- One Phaser canvas; no PlayCanvas, WebGL scene graph, secondary canvas, lights, materials, shadows, or post-processing.
- Generated 384×216 plates are checked in and palette-quantized to 32 colours. Moving fighters, gloves, balls, pins, trails, props, hit bursts, confetti, sweep bar, and top-down golf map are drawn by code.
- Boxing uses a first-person arcade view for player matches and a side-on broadcast view for Fight Night.
- Bowling projects every sim pin and the hook preview down the lane, so falling/removed pins match the solver.
- Golf projects the live ball and shot trail, switches to a sim-data top view, and palette-shifts the meadow/canyon/neon courses.
- `pixelArt`, `roundPixels`, disabled antialiasing, and CSS nearest-neighbour scaling keep edges crisp.

## Verification

`npm test` covers deterministic sims, replay timing, keymaps, bots, betting, agent execution/service fallbacks, smoke matches, and pixel projection. `npm run build` performs strict TypeScript checking before the production Vite build.

Development builds expose `window.__game`, `window.__advance(ms)`, and `window.__boxing` / `__bowling` / `__golf` for browser-driven verification.
