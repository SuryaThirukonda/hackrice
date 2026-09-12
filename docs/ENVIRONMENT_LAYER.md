# Low-poly environment layer

The deterministic simulation remains authoritative. This document was imported with the renderers from `origin/gauravbranch` and edited to match this repository.

Unchanged by this pass: the simulations, keymaps, HUDs, betting, and the agent service. Changed: the three game scenes now build their world asynchronously through `Engine3D.get()`, `src/main.ts` runs Phaser transparently over the PlayCanvas canvas, and the Settings "CRT SCANLINES" row became "3D QUALITY". The phone-controller relay that exists on `gauravbranch` (`src/input/controller.ts`) was **not** imported, so nothing here reads controller input.

## Files and responsibilities

- `src/engine3d/environment.ts`: material-cached scenery builder, beams and braced trusses, graphic display panels, faceted landscape peaks, and sport-specific resets of the shared lighting/camera clipping rig.
- `src/games/boxing/render/RingScene.ts`: tiered grandstands, 3D crowd blocks, venue structure, trusses, display, ring steps. Existing ring dimensions, ropes, pads and effects interfaces are retained. `BoxingWorld.ts` registers a dynamic crowd batch and selects the lighting rig.
- `src/games/bowling/render/LaneScene.ts`: repeating ceiling bays, warm light panels, rear displays, visible side spectators and seating. Removes overlapping legacy fixtures and thin aliasing board lines. Sky cannot cast shadows. Existing lane/pin coordinates and presentation update methods are retained. `BowlingWorld.ts` centers and backs up the camera to include the starting ball.
- `src/games/golf/render/CourseScene.ts`: mowing texture on the authoritative fairway polygon, faceted crowns, boundary tree line, distant peaks, green collar, non-shadowing sky. Hazard polygons and bunker radii are unchanged; additional trees and ridges sit outside the course bounds. `themes.ts` refines meadow colors while preserving canyon/neon themes. `GolfWorld.ts` raises the tee view and resets lighting on entry.
- `environment-preview.html` and `src/dev/environmentPreview.ts`: a separate development entry for static environment inspection. It is not imported by the game or included in the normal production build. It renders existing world classes without running a match; the golf overview uses the existing third meadow hole to show water.

## Review

Run `npm run dev`, then open `/environment-preview.html`. Use the Boxing / Bowling / Golf links. The regular game still uses the existing Phaser overlay and menu flow. The review page deliberately does not simulate a match or validate inputs.

Validation in this repository: production build clean and 138 tests in 12 files pass. The count moved from gauravbranch's 141 because the five `src/retro/proj.test.ts` pixel-projection tests retired with the 2D renderer into `legacy/2d/` (outside vitest's include patterns), and two bowling interpolation tests were added. Browser inspection covered all three worlds and boxing with the live Phaser HUD. No runtime errors were logged. Existing PlayCanvas sphere deprecation and Vite chunk-size warnings remain.

Not yet measured: sustained frame rate on the presentation laptop. This renderer set predates the performance pass in commit `b8e36ff`, so at the default "medium" quality it enables post-processing, device pixel ratio up to 2, shadows, three lights, and an environment atlas that `b8e36ff` had deliberately disabled. See the handoff notes before a projector demo.

## Constraints for later work

- Keep scenery out of simulation modules. Read hole definitions and lane/ring constants; never change them to match an asset.
- Preserve `WZ` in bowling and `MX` in golf when replacing meshes. Keep model origins at the existing surface and entity pivots.
- Reuse materials and static batch groups. Animated crowds use a dynamic batch; dressing disables shadow casting unless its shadow materially improves readability. No new shadow-casting lights were added.
- Replace one scene or prop family at a time. Check a full match, golf hole/theme transitions, all quality settings, and a 16:9 projector before presentation.
- Later polish: artist-made signage, reusable tree/seat meshes, measured draw-call budgets, and scene resource disposal for existing procedural meshes/textures. Tune art without changing authoritative outcomes.

The three image references were not available in the supplied attachments; this pass follows the written sport-specific composition and style guidance.
