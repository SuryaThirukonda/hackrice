# Boxing classes and Fight Night characters

The boxing opponent menu offers exactly four fixed classes: Rookie (beginner model), Pro (intermediate model), Champ (professional model), and Boss (hoodie and ginger beard). Boss uses its own stronger bot parameters. The menu launches the same TIERS values used by direct scene entry; it no longer overrides boxing classes with shared slider settings. Rating bars show reaction, aggression, blocking, dodging, and countering and are read-only for boxing.

Boxing selection is saved separately as boxingTier. Golf and bowling retain their presets and editable sliders, including Custom. Existing boxing preset selections migrate on first entry; legacy Custom falls back to Rookie.

Fight Night models follow the selected persona in either corner:

- Knuckles McGraw: human professional boxer, red gloves.
- The Professor: mint alien with large eyes and antennae, blue gloves.
- Lucky Lou: purple reptile with a snout and crest, gold gloves.
- Iron Maggie: steel robot with visor, grille, shoulder plates, and chest core, green gloves.

All models are procedural PlayCanvas entities with boxes and faceted meshes. They share the existing head, hip, and arm IK pivots; pose and combat mechanics are unchanged. Persona model and color travel from the lobby through BoxingScene to both spectator rigs. Model geometry does not change reach or hit detection.

Validation: production build and 252 existing tests pass. Browser checks cover the four-class menu and PlayCanvas geometry. The previously observed low-frame-rate spring instability remains outside this change.
