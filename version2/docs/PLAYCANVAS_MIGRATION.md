# PlayCanvas migration map

## Current boundary

The runtime already follows the intended ownership boundary:

```text
keyboard / future normalized phone actions
  -> deterministic TypeScript simulation at 120 Hz
  -> immutable snapshot
  -> presentation-only interpolation
  -> PlayCanvas world

Phaser remains responsible for menus, tutorials, HUD, settings, betting, and transitions.
```

`BowlingGame`, `BoxingMatch`, and `GolfRound` own rules, collision outcomes, scoring, timers, seeded randomness, and bot decisions. Their PlayCanvas worlds consume snapshots and may smooth transforms, move cameras, light scenes, and trigger effects. A renderer must never write back to a simulation or decide whether an event occurred.

## Repository findings

- `src/engine3d/` is a usable Engine-only PlayCanvas integration inside the existing Vite app. It owns one shared canvas behind Phaser, a manual render path, camera and light rigs, generated environment lighting, quality levels, toon materials, procedural textures, post processing, particles, and primitive helpers.
- Boxing, bowling, and golf already have deterministic TypeScript simulations and PlayCanvas render modules. Input, Fight Night agents, betting, audio, dev hooks, and the Phaser flow are independent of the renderer and remain in place.
- Bowling is the lowest-risk proof because its state is a ball position plus ten pin transforms in a fixed lane. It is the first migration checkpoint.
- The current branch contains no Godot files or GLB/glTF assets. Repository history contains a small Godot 4.3 phone-controller diagnostic (`project.godot`, one Control scene, and GDScript WebSocket/controller plumbing). It has no 3D scenes, shaders, models, textures, animation, audio, or environment art worth exporting. Its useful protocol ideas already exist in the TypeScript input layer.

## First checkpoint

Bowling uses the shared PlayCanvas app, a procedural low-poly alley, a fixed cinematic camera, toon materials, environment lighting, shadows, a ball, ten pins, particles, and a transparent Phaser HUD. Ball and pin transforms come only from `BowlingGame.snapshot()`. `render/interp.ts` smooths positions between fixed ticks while discrete phase, scoring, and pin state remain those of the current snapshot.

All procedural scene objects use semantic PlayCanvas entity roots, so future GLB replacements can be placed under the same roots with authoring scale and orientation isolated on a visual child. New transferable assets should use GLB/glTF and include a checked-in calibration record describing hierarchy, bounds in metres, forward axis, grounding offset, and animations.

## Remaining work

1. Add a reusable asynchronous GLB loader and asset calibration records when suitable art becomes available.
2. Replace the bowling primitives incrementally, starting with the ball and pin visual children, without changing their snapshot bindings.
3. Profile the production bundle and split PlayCanvas/game code from menu startup if load time matters on the demo laptop.
4. Apply the same explicit interpolation boundary and lifecycle review to golf, then boxing.
5. Connect normalized phone actions to the existing key/action abstraction in a separate input milestone.
6. Keep Presage outside the renderer and simulation migration until its player-state interface is defined.
