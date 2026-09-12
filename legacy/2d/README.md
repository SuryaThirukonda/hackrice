# Legacy Phaser 2D renderer

This directory preserves the retired September 2026 Phaser-only pixel renderer.

- `src/retro/` contains the low-resolution canvas stage, projections, Mode7 terrain, palette, and tests.
- `src/games/*/render/` contains the boxing, bowling, and golf pixel renderers.
- `public/art/` contains the generated 384×216 background plates.
- `docs/` contains the original 2D migration assessment and implementation plan.

These files are archival and are not included by the active TypeScript build. The live application uses the PlayCanvas renderer in the repository's `src/engine3d/` and `src/games/*/render/` directories.
