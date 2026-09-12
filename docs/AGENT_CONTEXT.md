# Agent context brief: The House Always Plays (HackRice 16 build)

Read this fully before touching anything. It is the condensed history of the build session so far.

## What this is
Phone-as-motion-remote sports game (bowling, baseball, boxing) on a projector against AI "House" opponents, wrapped in a
play-chip betting "rail" for every other phone. Product spec: `docs/house-always-plays-implementation-plan.md` (Part A is the
spec). Technical plan: `docs/TECH_PLAN.md`. Execution plan with milestones M0–M12: `/home/surya/.claude/plans/create-an-implementation-plan-foamy-iverson.md`.

## User requirements gathered during the session (all binding)
- Full hackathon scope (M0–M12), built by Claude in this repo; phones are not available, so everything must be verifiable
  headless (pytest, scripts) and in a browser with keyboard/synthetic input. Real-device threshold tuning is a documented human step.
- LLM persona uses **OpenAI** (env `OPENAI_KEY`; `openai` SDK; model in `backend/config/tiers.yaml` `persona.model`, currently `gpt-5-mini`). Never Anthropic.
- Voice: ElevenLabs (`ELEVENLABS_API_KEY`), offline cache fallback. No keys are present in this environment; everything must work without them.
- UI: home/dashboard is a **wooden-plank jungle menu** (inspired by classic mobile game menus, CSS only, original art). The rest is a
  **dark arcade theme** ("no common white backgrounds"), graphics inspired by current games: neon bowling alley, boxing ring under
  spotlights with crowd, night ballpark. Wii-like readability. Font: Nunito body, Lilita One display.
- **Keyboard controls for every game** so mechanics can be tested before phones: projector "Play with keyboard" (Enter) claims the
  open seat with a second socket and sends `input.action`; the desktop remote (`/remote?...&fake=1`) does the same. Boxing keys:
  J jab, K hook, Space (hold) block, P parry, A/D dodge. Bowling: arrows aim, A/D spin, hold+release Space to charge and roll.
  Baseball: Space swing, up/down swing height. Boxing must feel **real-time with proper interaction and hit physics**, with health
  and stamina bars and block/punch/parry options.
- Cloudflare: a Worker front door exists in `cf/` (serves `web/dist`, proxies `/ws` (WebSocket upgrade), `/api/*`, `/audio/*` to the laptop
  backend URL stored in KV namespace `hap-config`, id `5a5eeca4bc9f4d379051e8061562c187`). Verified locally with `wrangler dev` on :8787.
  Actual deploy needs the user's wrangler login; do not attempt it.
- Git: repo is on `main` with local commits; pushing needs the user's credentials. **Do not run git commit/push yourself**; the
  orchestrator commits.

## Architecture (as built)
- Backend `backend/` (Python 3.14, uv, FastAPI): one asyncio **arena loop** is the single writer (`app/arena.py`). WebSocket handlers only
  enqueue `Intent`s. Timers: `schedule_in/schedule_every/cancel` with string keys. `emit(type, d, to=...)` -> per-connection bounded
  `SendQueue` (droppable types: motion.meter, market.odds, match.tick, motion.status). **seq is per connection** (assigned at push).
  Clients resync on a gap. `ArenaLoop.step(now)` is synchronous for tests with `FakeClock` (`tests/conftest.py`: `arena`, `clock`,
  `make_client` fixtures, `run_for(arena, clock, seconds)`).
- Modules are wired in `app/wiring.py::_wire_optional_modules` by importing `app.<name>.install(arena)`; they live in `arena.modules[name]`:
  `motion.worker`, `market.wiring`, `games.wiring`, `agents.wiring`, `voice.wiring`, `market.sponsor`, `market.card`, `market.pairing`, (`host` not yet written).
- Protocol: `app/protocol.py` (pydantic payload models; `CLIENT_MESSAGES` dict, `SERVER_MESSAGES` tuple) mirrored by hand in
  `web/src/protocol.ts`; `backend/scripts/check_protocol.py` must pass. Motion sample = 13 numbers
  `[t_phone_ms, ax, ay, az, agx, agy, agz, rx, ry, rz, alpha, beta, gamma]`.
- Rooms/seats (`app/rooms.py`): seat tokens rotate on claim; same device may reconnect with a stale token; 20 s unclaimed release.
- Motion (`app/motion/`): `calib.py` (rest 2 s, raise 1 s), `filters.py`, `detectors.py` (Swing/Release/Punch/Block/Dodge/Shake/Flick/Bump
  state machines, constants in `backend/config/motion.yaml`), `synth.py` (synthetic signal generators; also ported to
  `web/src/lib/fakeMotion.ts`), `worker.py` (`MotionModule`: frames -> gestures -> `gesture_handlers`; `input.action` keyboard path
  builds a `Gesture` directly and marks the device calibrated via `motion.calib_done`).
- Games (`app/games/`): `base.py` (Match/TurnPlan/TurnResult), `wiring.py` (`GamesModule` turn driver: phases betting -> input ->
  resolving -> between; `_live_tick` at `plan.tick_ms` for boxing (50 ms; card 80 ms) and baseball (100 ms) calling `match.step(now=...)`;
  `decisions_before(phase)` -> `decision_provider` (persona) with default fallback; pause/resume; gap-check pauses only for
  streaming phones (`dev.hz > 0`); `host.start`, `host.card`, `host.next`, `host.pause/resume`, `host.force_scenario`), `bowling.py`
  (pin table, scoring, Pin King drift), `baseball.py` (timed pitches on the server timeline, contact formula, sudden death),
  `boxing.py` (fixed-tick sim: Fighter hp/stamina/guard/state machine; punch/block/dodge/parry; knockdowns; rounds; two-glove guard;
  `on_human_punch` hook for the rhythm learner), `scripted.py` (demo scenarios).
- Agents (`app/agents/`): `policy.py` (Option/DecisionRequest/TierConfig), `bowler.py`, `pitcher.py`, `boxer.py` (`HouseBoxer` state
  machine; `reacts_to_punch`), `adaptive.py` (EMA nudges one param per sport; `agent.studying` meter), `bosses.py` (`RhythmLearner`,
  `attach_boss`), `persona.py` (`OpenAIPersona` via `client.responses.parse(text_format=PersonaChoice)`, `OfflinePersona` taunt bank,
  `PersonaProvider` posts results as intents; never blocks a turn), `wiring.py`.
- Market (`app/market/`): `ledger.py` (append-only, integer chips, bailout), `bets.py` (`MarketBook`: parimutuel settle with
  floor payouts, remainder rollover, tie split, void, `assert_conserved`), `wiring.py` (`MarketModule`: windows, odds at 4 Hz,
  leaderboard/titles, `open_market/settle/void/end_match`), `sponsor.py` (moves from `config/market.yaml`, price vs advantage, caps,
  cooldown, warn timer, crate auction every 4 turns), `card.py` (vote between two pairings, idle auto-start), `pairing.py` (bump-to-pair).
- Voice (`app/voice/`): `triggers.py` (config/voice.yaml), `moderation.py`, `tts.py` (ElevenLabs/offline cache), `wiring.py` (one line in
  flight, priority replace, `voice.line` to projector; `host.unlock_audio`).
- Store: `app/store/db.py` single writer thread, `schema.sql`; `hap.db` in backend/.
- Config: `app/config.py` loads `backend/config/{motion,tiers,market,voice}.yaml` + `GAME_DEFAULTS`; env knobs `HAP_MODE`
  (normal|offline|scripted|headless), `HAP_FAST_TIMERS=1` (short windows; see `FAST_TIMER_OVERRIDES`), `HAP_DEV=1`, `HAP_PUBLIC_URL`.
- Web `web/` (Vite 8, React 19, TS strict with `erasableSyntaxOnly` -> **no constructor parameter properties**): routes `/`, `/remote`,
  `/rail`, `/projector`, `/host`. `src/lib/ws.ts` (`ArenaSocket`: seq gap -> resync, pings -> `serverNow()`), `src/lib/store.ts`
  (`useArena` zustand store applying every event; `window.__hap` debug handle), `src/lib/motion.ts` (device capture + batching),
  `src/lib/fakeMotion.ts`, `src/lib/keyboard.ts` (`KeyboardController`, `CONTROLS`), `src/projector/` (Projector.tsx layout, `stage/PixiStage.tsx`
  one Pixi 8 Application + `Scene` interface + effects shake/hitstop/slowmo, `stage/BowlingScene.ts`, `stage/BoxingScene.ts`,
  `stage/BaseballScene.ts`, `OddsBoard.tsx`, `Overlays.tsx` (LeaderboardStrip, Subtitle, Versus, PhaseBanner, ScoreCard, Meter,
  StudyingMeter, BaseballBoard), `FightHUD.tsx`, `KeyboardPlayer.tsx`, `audio.ts`), `src/rail/Rail.tsx`, `src/remote/Remote.tsx`,
  `src/host/Host.tsx`, `src/ui/ChannelGrid.tsx` (`PlankMenu`), `src/ui/planks.css`, `src/index.css` (dark theme tokens).
- Scripts (`backend/scripts/`): `fake_remote.py` (phone stand-in over the real socket; `--auto` plays matches), `fake_rail.py` (betting
  bots), `hostctl.py` (`seats|start|card|send|watch|wait-end`), `headless_sim.py` (`simulate(sport, tier, n)` win rates),
  `replay_trace.py`, `gen_synth_traces.py`, `record_trace.py`, `persona_smoke.py`, `precache_voice.py`, `check_protocol.py`, `_client.py`.
- Tests: `cd backend && uv run pytest -q -m "not slow"` (currently 109 pass, 3 fail in `tests/test_m10.py`, see below);
  `uv run pytest -q -m slow` runs `tests/test_sim_bands.py` (win-rate bands per tier).

## Current known issues / pending
- `tests/test_m10.py` has 3 failing tests with known fixes not yet applied: (1) Pin King re-rack should happen in `BowlingMatch.next_prompt()`
  when ball 2 is prompted (set standing to {7,10}, append a `rerack` tick, return `twist: True`), not in `on_gesture`; (2) `oil_shift` move
  delta 0.2 exceeds `max_swing` before the count cap — set delta to 0.15 in `config/market.yaml`; (3) `PairingModule` must settle a
  pair only after `pair_window_ms` (schedule key `pair.settle`, cancel it when a third phone bumps -> re-bump prompt), and the test must
  advance the clock ~0.4 s after the second bump.
- Rail UI has no sponsor drawer, crate bid sheet, card vote, or pairing buttons yet; projector has no banners for sponsor.warn/applied,
  crate.open/result, card.vote_open/result, pair.prompt/result; BowlingScene does not animate the re-rack tick.
- `app/host.py` does not exist (host.* handlers are spread: rooms.py handles seats/public_url/kick; games handles start/pause/next;
  motion handles toggle). Host.tsx exists but lacks param sliders, scenario dropdown, telemetry, Worker backend-URL admin.
- No `scripts/replay_match.py`, `scripts/rehearsal.sh`, `scripts/load_check.mjs`, `tests/test_backpressure.py`.
- Boxing is a fixed-tick sim without positions/range; punches land instantly; the scene interpolates poses only.

## Conventions and hard rules for agents
- Do not touch files outside your ownership list except the explicitly listed shared files, and for those: re-read the file right
  before editing, make minimal additive edits, never reformat or rewrite wholesale.
- Do not run `git` (no commits/pushes). Do not stop/restart the shared dev servers on ports 8000 (backend), 5173 (Vite), 8787 (Worker).
  For live checks run your own backend on your assigned port: `cd backend && HAP_FAST_TIMERS=1 HAP_DEV=1 uv run uvicorn app.main:app --port <PORT>`
  in the background, after `cd web && npm run build` (the backend serves `web/dist` at http://localhost:<PORT>/projector etc., same-origin /ws).
  Fake clients: `uv run python scripts/fake_remote.py --url ws://localhost:<PORT> ...`, `scripts/hostctl.py --url ws://localhost:<PORT> ...`,
  `scripts/fake_rail.py --url ws://localhost:<PORT> ...`. Kill your own server when done.
- Keep green: `cd backend && uv run pytest -q -m "not slow"`, `uv run python scripts/check_protocol.py`, `cd web && npm run build`.
- Use absolute paths in shell commands (the shell's cwd drifts).
- TypeScript: strict; no unused locals; no constructor parameter properties; `env.d` payloads are `any` in store.ts.
- Everything must work with no API keys (offline persona/voice); if `backend/.env` has `OPENAI_KEY`, you may run `scripts/persona_smoke.py` once.
- Report back with: what you changed (files), how you verified it (commands + observed output), and anything left open.
