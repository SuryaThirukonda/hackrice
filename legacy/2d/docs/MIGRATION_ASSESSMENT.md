# Phaser pixel migration assessment

## Repository decision

`version2` was the active product and the root `backend/`, `web/`, `cf/`, and phone-motion traces belonged to the retired first version. The active app is promoted to the repository root after verification. The root `.env` is preserved because only the optional Node Fight Night service reads its OpenAI key.

## Boundary assessment

The migration does not change gameplay logic. Each sport already had the correct separation:

- fixed-step deterministic simulation at 120 Hz;
- input/keymap adapter;
- HUD and scene flow;
- a renderer receiving snapshots and events.

PlayCanvas lived entirely behind that renderer boundary. It was therefore safe to remove the GPU scene graph while retaining the same hit resolution, stamina, knockback, bowling disc collisions and scoring, golf launch/drag/lift/bounce/roll/hazard rules, seeded bots, betting, and replay behavior.

## Implemented rendering model

The replacement is traditional flat pixel art, not a pixel filter over 3D:

- a 384×216 `CanvasTexture` is drawn and displayed by Phaser with nearest-neighbour scaling;
- checked-in generated plates provide the arena, alley, and golf skyline;
- procedural sprites draw fighters, gloves, pins, balls, club/hands, effects, and score feedback;
- bowling uses a chaseable perspective lane and projects the solver's x/z positions;
- golf rasterizes the physics hole data once, then samples it as a moving Mode-7 ground plane from the ball camera;
- Fight Night uses the same boxing snapshot in a flat side-on broadcast composition;
- CRT scanlines are an optional presentation setting.

The renderers consume sim coordinates but never write back to the sims.

## Verification

- Baseline before migration: 136 tests passing.
- After migration: sim, bot, keymap, betting, service, smoke, projection, chase-camera, and course-raster tests pass.
- Strict TypeScript and Vite production build pass.
- Browser verification covers title/menu navigation, boxing countdown and input, bowling aim/lock view, and golf aim/flight with the ground camera visibly advancing from tee toward the green.
