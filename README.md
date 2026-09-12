# The House Always Plays

A Phaser + PlayCanvas arcade sports collection with boxing, bowling, golf, and AI-vs-AI Fight Night betting. Phaser owns the menus, HUD, input, and deterministic 120 Hz simulations; PlayCanvas renders the interactive 3D sports environments behind it.

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

All game bindings can be changed in Settings. PlayCanvas quality can be switched between low, medium, and high there.

## Architecture

```text
src/main.ts                 Phaser game and scene flow
src/engine3d/               shared PlayCanvas device, cameras, lighting and effects
src/games/*/sim/            deterministic 120 Hz gameplay and bots
src/games/*/render/         PlayCanvas ring, lane, course and character models
src/games/*/hud/            score, health, meters, help and results
src/scenes/                 title, menus, settings, tutorial and Fight Night
src/agent/ + server/        browser agent link and server-side OpenAI service
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
