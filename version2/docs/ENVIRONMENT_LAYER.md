# Low-poly environment layer

The deterministic simulation remains authoritative. This pass changes only PlayCanvas presentation; normalized input, simulation, controller relay, betting, agents, Presage, and Phaser scene/HUD code are unchanged.

## Files and responsibilities

- `src/engine3d/environment.ts`: material-cached scenery builder, beams and braced trusses, graphic display panels, faceted landscape peaks, and sport-specific resets of the shared lighting/camera clipping rig.
- `src/games/boxing/render/RingScene.ts`: tiered grandstands, 3D crowd blocks, venue structure, trusses, display, ring steps. Existing ring dimensions, ropes, pads and effects interfaces are retained. `BoxingWorld.ts` registers a dynamic crowd batch and selects the lighting rig.
- `src/games/bowling/render/LaneScene.ts`: repeating ceiling bays, warm light panels, rear displays, visible side spectators and seating. Removes overlapping legacy fixtures and thin aliasing board lines. Sky cannot cast shadows. Existing lane/pin coordinates and presentation update methods are retained. `BowlingWorld.ts` centers and backs up the camera to include the starting ball.
- `src/games/golf/render/CourseScene.ts`: mowing texture on the authoritative fairway polygon, faceted crowns, boundary tree line, distant peaks, green collar, non-shadowing sky. Hazard polygons and bunker radii are unchanged; additional trees and ridges sit outside the course bounds. `themes.ts` refines meadow colors while preserving canyon/neon themes. `GolfWorld.ts` raises the tee view and resets lighting on entry.
- `environment-preview.html` and `src/dev/environmentPreview.ts`: a separate development entry for static environment inspection. It is not imported by the game or included in the normal production build. It renders existing world classes without running a match; the golf overview uses the existing third meadow hole to show water.

## Review

Run `npm run dev`, then open `/environment-preview.html`. Use the Boxing / Bowling / Golf links. The regular game still uses the existing Phaser overlay and menu flow. The review page deliberately does not simulate a match or validate inputs.

Validation: production build and 141 existing tests passed. Browser inspection covered all three worlds, boxing with the live Phaser HUD, and the corrected bowling starting-ball framing. No runtime errors were logged. Existing PlayCanvas sphere deprecation and Vite worker/chunk warnings remain. Hardware/projector frame rates and a complete controller-driven round were not benchmarked.

## Constraints for later work

- Keep scenery out of simulation modules. Read hole definitions and lane/ring constants; never change them to match an asset.
- Preserve `WZ` in bowling and `MX` in golf when replacing meshes. Keep model origins at the existing surface and entity pivots.
- Reuse materials and static batch groups. Animated crowds use a dynamic batch; dressing disables shadow casting unless its shadow materially improves readability. No new shadow-casting lights were added.
- Replace one scene or prop family at a time. Check a full match, golf hole/theme transitions, all quality settings, and a 16:9 projector before presentation.
- Later polish: artist-made signage, reusable tree/seat meshes, measured draw-call budgets, and scene resource disposal for existing procedural meshes/textures. Tune art without changing authoritative outcomes.

The three image references were not available in the supplied attachments; this pass follows the written sport-specific composition and style guidance.
