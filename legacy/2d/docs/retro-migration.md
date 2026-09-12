# Retro migration: PlayCanvas 3D to an all-Phaser pixel-art game

> Status: implemented September 12, 2026. See `MIGRATION_ASSESSMENT.md` for the final architecture and verification notes. The implementation uses the recommended in-place, 384×216, checked-in-asset, side-on Fight Night choices.

Target look: the three mockups (first-person Punch-Out boxing, first-person lane bowling, first-person tee-shot golf), a 16-colour-per-scene palette, a black top bar HUD with a pixel font, chunky outlines, no lighting.

## 1. What stays exactly as it is

About 70 % of the code never sees the renderer and does not change:

- Sims: `games/boxing/sim`, `games/bowling/sim`, `games/golf/sim` (120 Hz, deterministic, bots, tiers), `agent/sliders.ts`, keymaps, tutorial pages and practice steps, `betting/book.ts`, `agent/*`, `server/*`, all 136 tests.
- Scene flow: Boot, Title, MainMenu, ModeSelect, GameSelect, PreFight, Tutorial, Settings, FightNight, the three game scenes' input/sim/HUD loops, transitions, sfx.
- The renderer contract each game scene already uses: a `world` object with `show/hide/resize`, `apply(snapshot, aimState, dt)`, and event hooks (`hitFx`, `knockdownFx`, `cheer`, `shake`, `punchKick`, `setPreview`, `setAimPath`). The migration swaps the class behind that contract; the scenes change only in construction (synchronous, no `Engine3D.get()`).

## 2. What goes

- `src/engine3d/*` (Engine3D, ChaseRig, materials, primitives, textures, fx, post, env, springs stays), `games/*/render/*` (all PlayCanvas rigs, ring, lane, course), the second canvas, the `playcanvas` dependency, the 3D quality setting and its Settings row.
- `poses.ts` survives as pure maths (glove targets per state) and feeds the 2D puppet.

## 3. New rendering base: `src/retro/`

- Pixel canvas: one logical resolution for the whole game, 384 x 216 (16:9, x5 = 1920 x 1080). `pixelArt: true`, `roundPixels`, `Scale.NONE` plus our own integer zoom on resize (floor of min(W/384, H/216)), letterboxed and centred. The mockups are 4:3; 320 x 240 is the alternative if you prefer that framing.
- `palette.ts`: a master 32-colour palette and per-scene 16-colour subsets; a quantiser used by the asset pipeline and by procedural painters.
- `pixelfont.ts`: a code-drawn 5 x 7 bitmap font (and a 3 x 5 small one) exported as a Phaser BitmapText font, so text lands on the pixel grid (web fonts blur at this scale).
- `ui/widgets.ts` and `pauseOverlay.ts` rewritten as pixel panels (black boxes, 1 px light border, bevel), `transitions.ts` becomes a checkerboard or scanline wipe.
- `proj.ts`: one fixed first-person camera per game: `project(x, y, z) -> { sx, sy, scale }` (camera height, focal length, horizon row). All three games draw actors through it so depth reads consistently.
- `mode7.ts`: pseudo-3D ground. Each golf hole (and the bowling lane) is rasterised once top-down into an `ImageData` map (1 px = 1 m for golf, 2 cm for the lane), then each frame rows below the horizon sample that map per pixel (about 384 x 110 = 42k lookups, well under 2 ms). Aim rotation, ball flight camera and green-side cuts all fall out of moving the camera.
- `puppet.ts`: the boxer as a procedural pixel puppet (head, torso, trunks, arms as thick pixel lines, gloves as scaled discs), posed from `poses.ts` and projected with `proj.ts`; front view for the opponent, side view for Fight Night. Squash, hit flash and palette swaps are cheap. If you supply a hand-drawn sprite sheet later it drops in behind the same pose-to-frame mapping.
- `stage.ts`: base class for the three stages: layer order, shake (layer offset), flash, event bursts drawn as 3-frame pixel sprites, a `RenderTexture` for the 384 x 216 frame.

## 4. Per-game stages

**Boxing (Punch-Out framing).** Layers back to front: crowd plate (two-frame cheer by palette swap on events), signage, ropes drawn as sagging lines that wobble on hits, canvas, opponent puppet at centre scaled by `dist` and shifted by both fighters' `head.x` (sway) and by duck (vertical), the player's two gloves at the bottom driven by the player's state (guard, block up, jab and cross lunges, sway tilts the whole frame). Knockdown: puppet down frames plus a vertical camera drop. KO stamp from the HUD. Fight Night: side-view stage with two puppets and the ring in profile, same sim.

**Bowling.** Lane plate with perspective, foul line, arrows; pins as sprites at the ten spots via `project`, three states (standing, falling with the tilt direction from the sim, gone), a sweep bar animation between balls; the ball sprite scaled along the sim path so hook is visible; the predicted path as projected dots while aiming; approach camera slides with lane position. Scoresheet strip at the top like the mock.

**Golf.** Sky band with drifting cloud sprites (wind), mountain and treeline layers with parallax on aim, Mode-7 ground from the hole data (fairway stripes, rough, bunkers, water, green), flag and trees as depth-sorted billboards, tee marker, the club and gloved hands at the bottom for the swing (three frames: address, back, follow-through), ball projected in flight with the camera tracking it, then a green-side view for the roll. Top view stays as the map.

## 5. Assets: plates from generated art, actors from code

- Backgrounds ("plates") come from generated images like the three mockups: arena without fighters, empty lane, fairway per theme, plus separated sky and cloud layers. A small pipeline in `scripts/art.ts` (node, pngjs) downsamples to 384 wide, quantises to the scene palette, chroma-keys magenta to alpha, and packs an atlas plus JSON into `public/art/`. Checked in, a few hundred KB.
- Actors, HUD, effects, fonts stay procedural so poses follow the sim and nothing needs frame authoring. Every plate has a procedural fallback (gradient sky, drawn ring, drawn lane) so the game runs before any art exists.
- Palette discipline: the quantiser enforces the scene palette on plates, so generated images and code-drawn sprites share colours.

## 6. Order of work

1. Pixel canvas, integer zoom, bitmap font, palette, pixel widgets; convert the shell scenes and the three HUDs to the 384 x 216 grid (top bar layout from the mocks). Game scenes render black for now. (3 to 4 h)
2. Boxing stage: puppet, gloves, ring plate, events; replace BoxingWorld behind the same contract; Fight Night side view. (4 to 5 h)
3. Bowling stage. (3 h)
4. Golf stage with Mode-7 ground and the two camera modes. (5 to 6 h)
5. Asset pipeline and first plates; palette pass. (2 h)
6. Delete engine3d and render dirs, drop playcanvas, replace the quality setting with CRT scanlines on/off, add unit tests for `proj`, `mode7` and the pose-to-puppet mapping, update the README. (1 to 2 h)

Each step keeps the game playable end to end: stages fall back to procedural drawing until their plates land, and the sims and tests never change.

## 7. Decisions to make before starting

1. In place on a branch of `version2` (recommended: the sims, scenes and tests are reused as is) or a copied `version3` folder.
2. Logical resolution: 384 x 216 (16:9, matches laptops and the projector) or 320 x 240 (4:3, matches the mockups).
3. Assets: allow checked-in generated PNG plates (recommended) or code-only art.
4. Fight Night view: side-on broadcast view (recommended) or first-person from corner A with an inset.
