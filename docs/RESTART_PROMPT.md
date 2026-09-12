# Restart brief: The House Always Plays

Paste this document as the opening prompt of a fresh session. It is the complete record of the first build: the product, every
decision and requirement the user gave, the architecture as built, what is in the repo and its exact state, what to reuse, every
issue met, and the plan for the rebuild: games first on Phaser, then the platform on top, reusing the FastAPI game server.

---

## 1. Event and product context

- **Event:** HackRice 16, Rice University, Houston, September 11–13 2026, 36 hours, teams of four, casino / poker / horse-racing
  theme. Track: Games & Gamification. Judging (expected): technical difficulty, design and polish, creativity, practicality; a
  flawless live demo matters most. Rules allow pre-existing ideas; all code is written at the event.
- **Team:** four Texas A&M CS undergrads; strengths in real-time web/backend (FastAPI, WebSockets), ML, CV, voice/UX. Keys
  available: OpenAI (the user chose OpenAI over Anthropic for personas). No drones, no custom hardware, browser-only phones.
- **Pitch:** Wii-Sports-style motion sports (bowling, baseball, boxing) on a projector, phones as remotes, against AI "House"
  opponents with names, voices and personalities (four tiers per sport plus a boss with a twist), wrapped in a casino sports book:
  every other phone is a betting slip with parimutuel play chips, live odds and a bettor leaderboard. Agent-vs-agent "Fight Night"
  cards fill dead air. Play chips only, no cash value, no purchases.
- **Original product spec:** `docs/house-always-plays-implementation-plan.md` (Part A spec: phases P0–P4, architecture, motion
  pipeline, engines, agents, rail, phones-together, voice, art, data, ops, testing, roles, risks, demo script; Part B background
  research: feasibility of `devicemotion` on iOS/Android, HTTPS requirement, permission gating, latency, bump-to-pair, Salty Bet
  betting model, adaptive difficulty references).
- **Technical plan for the hackathon build:** `docs/TECH_PLAN.md` (stack, repo layout, wire protocol, detector algorithms with
  constants, engine formulas, market math, persona interface, schema, config, tests, task board, H0 bootstrap). Written for the
  Python-engine era; still the reference for formulas and constants.

## 2. Requirements and decisions the user gave during the session (binding)

1. Build the full hackathon scope (M0–M12) in this repo; Claude executes; no phones are attached, so everything must be
   verifiable headless (pytest, scripts) or in the in-app browser with keyboard / synthetic input.
2. **OpenAI, not Anthropic**, for the persona layer. Env placeholder `OPENAI_KEY`. Model configured in `backend/config/tiers.yaml`
   under `persona.model` (currently `gpt-5-mini`). Everything must also run with no keys.
3. **Home screen:** a channel-style menu showcasing all minigames for the host; first "copy the Wii UI" (light, rounded, channel
   grid), then revised to a **wooden-plank jungle menu** inspired by a classic mobile game menu image (planks with carved
   text on a leafy green ground, CSS/canvas only, original art), and the rest of the UI a **dark arcade night theme**: "no common
   white backgrounds", graphics inspired by current games (neon bowling alley, boxing ring under spotlights with crowd, night
   ballpark). Fonts: Nunito (body), Lilita One (display).
4. **Boxing must be playable with the keyboard** with block, punch and parry options, health and stamina bars, so mechanics can
   be tested before phones. **Keyboard controls for all games.** It is an interactive game: real-time, proper interaction and hit
   physics, two boxers with detail, animations and sound effects throughout, longer rounds, standard boxing structure with a
   3-2-1 countdown, characters move forwards and backwards, throw punches or deflect.
5. **Standard game UI flow:** welcome page → mode select (1 player vs agent, then multiplayer) → game mode select → remote
   selector → 3-2-1 → the game. The whole UI and every dashboard must use the game engine ("the entire UI should use Phaser, and
   every single dashboard should be optimized with Phaser"). Reset the projector, host and rail pages; the main page shows a
   welcome page with each game working, you navigate into a game, and below it there are options to start a hosted game.
6. **Engine:** first Pixi scenes inside React, then the user asked whether Godot would be easier (assessment: no, the boxing
   problems were mechanics, not boilerplate); then the user chose to migrate to Godot and asked for an architecture (written,
   then a full Godot project with sims and flow was built and partly tested); then the user switched to **Phaser** for
   JavaScript-based development, asked to delete the Godot work, clean the codebase, and focus on the boxing mechanic first.
7. **Phone motion tracking is deprioritised**; do not spend time on it now. Keep the path.
8. **Cloudflare:** deploy the client to Cloudflare Workers with WebSocket support (a Worker front door was built and verified
   locally; deployment needs the user's wrangler login or an API token). Cloudflare Tunnel (`cloudflared` quick tunnel) is free
   and is the way phones reach the laptop server; `npx wrangler tunnel quick-start --url http://localhost:5173` needs no sudo.
9. **Git:** repo initialised; remote https://github.com/SuryaThirukonda/hackrice.git; the push needs the user's credentials
   (no `gh`, no SSH key, missing credential helper on the machine). The user committed the tree themselves ("update", "godot");
   the user said **do not commit** further without being asked.
10. Cost questions answered: Cloudflare Tunnel is free (quick tunnels: no account, 200 concurrent request cap, random
    trycloudflare.com URL); nothing of the app is hosted online except the tunnel relay and the metered OpenAI / ElevenLabs APIs.
11. The user asked for subagents (Fable 5.1) to finish remaining work in parallel with full context; three ran (market features,
    boxing real-time physics, host and hardening); the boxing one was killed by the user to prioritise the engine migration.

## 3. Architecture as built

### 3.1 Topology
```
phones (remote/rail pages) ─WSS via tunnel or the Worker─▶ FastAPI arena ◀─ws://localhost:8000/ws?role=game─ game client (Phaser)
projector / host pages ◀── sequenced event stream ────────┤ rooms · motion · ledger · markets · sponsor · card · pairing
                                                          │ persona (OpenAI) · voice (ElevenLabs) · store · host · bridge
                                                          └── SQLite (events, ledger, game log)
```
- One Python process, one asyncio **arena loop** as the single writer (`backend/app/arena.py`). WebSocket handlers only enqueue
  `Intent`s. Timers: `schedule_in/schedule_every/cancel` keyed by string. `emit(type, d, to=...)` routes to per-connection bounded
  `SendQueue`s; droppable high-rate types (`motion.meter`, `market.odds`, `match.tick`, `motion.status`) are dropped first when a
  client is slow. **`seq` is per connection, assigned at push time**, so a gap means real loss and clients `session.resync` for a
  `session.snapshot`. `step(now)` is synchronous for tests with `FakeClock`.
- Modules are installed by `app/wiring.py::_wire_optional_modules` (`app.<name>.install(arena)`), stored in `arena.modules`:
  `motion.worker`, `market.wiring`, `games.wiring` (Python engines) **or** `games.bridge` (installed under the same key when
  `HAP_ENGINE=client`), `agents.wiring`, `voice.wiring`, `market.sponsor`, `market.card`, `market.pairing`, `host`.
- **Wire protocol** (`app/protocol.py`, mirrored by hand in `web/src/protocol.ts`, checked by `backend/scripts/check_protocol.py`):
  envelope `{t, seq, match, ts, d}` server→client, `{t, cseq, d}` client→server; roles `remote | rail | projector | host | game`;
  motion sample = 13 numbers `[t_phone_ms, ax, ay, az, agx, agy, agz, rx, ry, rz, alpha, beta, gamma]`.
  Client types: `session.hello/ping/resync/nickname`, `motion.frame/calib_done`, `input.action` (keyboard: swing, release, punch,
  block_on/off, dodge, parry, bump, shake, flick, move), `market.bet`, `sponsor.buy`, `crate.bid`, `card.vote`, `pair.request`,
  `host.*` (telemetry, start, pause, resume, next, force_scenario, set_param, kick, release_seat, lock_seat, set_public_url,
  reload_config, toggle, set_seats, card, unlock_audio, adjust_chips, set_backend_url), `game.hello/turn_open/phase/
  decision_request/state/turn_result/match_end/log/kb/error/request_start`.
  Server types: `session.welcome/pong/snapshot/error`, `motion.status/meter/gesture/calib`, `seat.update`, `match.start/phase/tick/
  turn_result/end/pause`, `agent.decision/studying`, `market.window/bet_ack/odds/settle/leaderboard/balance`, `sponsor.warn/
  applied/ack`, `crate.open/result`, `card.vote_open/vote_result`, `pair.prompt/result`, `voice.line`, `sfx.play`, `host.ack/config/
  diagnostics`, `ladder.update`, `game.start/turn_go/gesture/decision/adjust/pause/resume/abort/config`.
- **Rooms** (`app/rooms.py`, `state.py`): seat sets `single [P1]`, `two_glove [L, R]`, `head_to_head [A, B]`, `tag_team [ACTIVE, BENCH]`;
  seat tokens `token_urlsafe(12)` rotate on claim (the scanned QR dies, the phone gets the private token); the same device may
  reconnect with a stale token; unclaimed/uncalibrated seats release after 20 s; join URL `{public_url}/remote?seat=P1&tok=…`;
  rail URL `{public_url}/rail`; snapshots are role-scoped (rail never sees tokens; host and game get `seat_tokens`).
- **Motion** (`app/motion/`): `calib.py` (rest 2 s → gravity, noise, `a_thr = max(12, mean + 8σ)`; raise 1 s → forward axis; rate
  check), `filters.py` (EMA), `detectors.py` (Swing/Release/Punch/Block/Dodge/Shake/Flick/Bump state machines, constants in
  `config/motion.yaml`; idle set = swing + bump; bump gated by rotation), `synth.py` (generators + trace catalog; ported to
  `web/src/lib/fakeMotion.ts`), `worker.py` (`MotionModule`: frames → gestures → `gesture_handlers`; `motion.meter` 15 Hz;
  `input.action` builds a `Gesture` directly and marks the device calibrated; `motion.calib_done` marks keyboard remotes ready).
- **Games driver** (`app/games/wiring.py`, Python-engine mode): phases betting → input → resolving → between, `_live_tick` for
  tick-based sports (boxing 50 ms, card 80 ms, baseball 100 ms) calling `match.step(now=...)`, decisions before phases via
  `decision_provider` with default fallback, pause/resume with timer freezing, gap-pause only for streaming phones (`dev.hz > 0`),
  `host.start/card/next/pause/resume/force_scenario`, scripted scenarios (`scripted.py`), ladder update, store rows.
- **Bridge** (`app/games/bridge.py`, `HAP_ENGINE=client`): `GameBridge` installed under `games.wiring`; `RemoteMatch` shadow with
  `send_adjust/send_effect` hooks so adaptive and sponsor modules work unchanged; one **active game client** (newest `game.hello`
  or whoever sends `game.request_start`; others get `game.abort`); on `game.turn_open` it opens the declared markets and a betting
  window then sends `game.turn_go`; `game.decision_request` → persona → `game.decision`; `game.state` → `match.tick` for the
  other pages; `game.turn_result` settles markets, fires voice triggers, runs adaptive; `game.match_end` settles the match market,
  ladder, `match.end`; `game.kb` claims a seat for a virtual keyboard device (`kb:<seat>`) and re-enters the gesture path;
  `game.request_start {sport, mode: 1p|2p|card, tier}` derives seat modes (1p → single, 2p → head_to_head);
  engine disconnect ends the match. `app/games/gameclient.py::PythonGameClient` drives the Python engines over the same contract
  (used by `tests/test_bridge.py` and `scripts/fake_game.py`).
- **Python sport engines** (`bowling.py`: lane path `x(d) = lane + drift·d − hand·0.8·clamp(spin/400)·(1−0.5·speed)·d²`, pin-fall
  table keyed by pocket error with pocket at ±0.29, partial-rack geometry, ten-pin scoring, quick 5 frames, Pin King oil drift and
  7-10 re-rack on frame 3 ball 2; `baseball.py`: pitch set with travel times, contact `|Δt| ≤ W`, quality/direction/distance,
  outcome lookup, 3 innings × 3 outs, reading pitcher, Closer sudden death with a 300-chip House stake; `boxing.py`: the abandoned
  real-time rewrite from the killed subagent, kept only as the fallback, two tests `xfail`).
- **Agents** (`app/agents/`): `policy.py` (Option, DecisionRequest, TierConfig, noisy_pick), `bowler.py`, `pitcher.py`, `boxer.py`,
  `adaptive.py` (EMA of success, nudges one param per sport from `tiers.yaml` `adaptive` spec, k=0.3, emits `agent.studying`),
  `bosses.py` (`RhythmLearner`, `attach_boss`), `persona.py` (`OpenAIPersona` via `client.responses.parse(text_format=PersonaChoice)`
  under a 1.5 s `wait_for`, `OfflinePersona` taunt bank with 0–200 ms simulated latency, `PersonaMemory`, `PersonaProvider` posting
  results as intents; invalid/timeout/refusal → engine default), `wiring.py`.
- **Market** (`app/market/`): `ledger.py` (append-only integer chips; join grant 500; bailout 100 when < 10 after 60 s),
  `bets.py` (`MarketBook`: parimutuel, floor payouts, remainder → rollover to the next market of the same match, ties split evenly
  then pro rata, void refunds, `assert_conserved` after every settle), `wiring.py` (windows, odds at 4 Hz, leaderboard with titles
  Hot hand / Called it / Whale, `open_market/settle/void/end_match`, test market via `host.force_scenario {kind: test_market}`),
  `sponsor.py` (moves from `config/market.yaml`: boss_dodge, fast_pitch, oil_shift 0.15, extra_frame, slow_pitch, second_wind;
  price = base × clamp(1 + 0.8·2·(implied − 0.5), 0.5, 2); caps per match, cooldowns, `max_swing` 0.35 of the param range, 2 s warn
  then apply; crate every 4 turns with a 15 s sealed-bid auction), `card.py` (two random pairings, 15 s vote, idle room auto-vote
  after 20 s when a rail is connected), `pairing.py` (bump-to-pair within 150 ms, settle after the window, three phones → re-bump;
  transfer chips, pass seat, bind glove, tag).
- **Voice** (`app/voice/`): `triggers.py` from `config/voice.yaml` (priorities 3 knockdown/strike/home run/boss twist, 2 upset/
  payout/taunt/match start/end, 1 turn result), `moderation.py` (blocklist, 90 chars, strip other players' names), `tts.py`
  (`ElevenLabsTTS`: POST `text-to-speech/{voice_id}?output_format=mp3_44100_128`, model `eleven_flash_v2_5`, sha1 disk cache,
  3 s timeout; `OfflineTTS` cache-only with `url: null`), `wiring.py` (one line in flight, priority replace, 6 s stale drop).
- **Host** (`app/host.py`): `host.set_param` with YAML write-back that keeps `HAP_FAST_TIMERS` overrides off disk, live detector
  rebuild, `host.reload_config`, `host.telemetry`, `host.set_backend_url` (POST to the Worker), `host.config` on host hello,
  1 s `host.diagnostics` with tick p95, per-socket drops, match/phase, market counts, store rows.
- **Store** (`app/store/db.py`, `schema.sql`): single writer thread, 250 ms batches, WAL, tables devices, seats, matches, turns,
  gestures, motion_frames, agent_decisions, ledger, bets, markets, sponsor_moves, voice_lines, game_log; `HAP_DB` override.
- **Config** (`app/config.py`): loads `config/{motion,tiers,market,voice}.yaml` + `GAME_DEFAULTS` (bowling quick_frames 5, k_hook
  0.8, gutter 0.92, pocket 0.28, roll 2.5 s, input window 20 s; baseball 3 innings, 3 outs, at-bat window 45 s, pitch gap 2.5 s,
  pitch set fastball 900 ms, changeup 1250, curve 1100 brk −0.4, high/low/inside/outside, knuckle with late break; boxing tick 50 ms,
  card tick 80 ms, round 30 s × 3, rest 3, down 3 s, jab 8 + 10·power, hook ×1.4, block ×0.2, stamina jab 10 hook 16, regen 4/8).
  Env: `HAP_MODE=normal|offline|scripted|headless`, `HAP_FAST_TIMERS=1` (betting 0.4 s, between 0.2 s, boxing round 6 s, baseball
  pitch gap 0.8 s, at-bat window 20 s, calibration shortened), `HAP_DEV=1`, `HAP_PUBLIC_URL`, `HAP_ENGINE=python|client`,
  `OPENAI_KEY`, `ELEVENLABS_API_KEY`.
- **Tiers** (`config/tiers.yaml`): bowling Gutter Gus / Spare Change / Perfect Game / The Pin King (lane_sigma 0.42 / 0.22 / 0.2 /
  0.12, speed and spin means rising, adaptive param `lane_sigma`); baseball Batting Practice Pete / The Changeup / The Ace / The
  Closer (W_ms 100 / 90 / 90 / 55, read_strength 0 / 0.6 / 0.9 / 1.0, Closer sudden death, adaptive `W_ms`); boxing Sparring Sam /
  The Counter / The Brawler / The House Champ (aggression 0.55 / 1.0 / 1.15 / 1.1, telegraph 600 / 400 / 300 / 250 ms, reaction
  500 / 250 / 220 / 160 ms, Counter counters, Champ rhythm learner, adaptive `reaction_ms`). Each tier has a voice id, persona
  prompt, taunt bank, accent colour, signature. Headless win-rate bands per tier (`tests/test_sim_bands.py`, slow): rookie
  0.55–0.9, contender 0.4–0.75, champion 0.2–0.5, boss 0.05–0.35; bowling and baseball pass; boxing depends on the client sim now.

### 3.2 Client (`web/`, Vite 8, TypeScript strict with `erasableSyntaxOnly`: no constructor parameter properties)
- **Phaser 3.90 game client** (`web/src/game/`): `client.ts` (`GameClient`: role `game` socket, sims by sport, turn flow
  betting → 3-2-1 countdown → input → resolving → between, persona decision requests, keyboard seat binding via `game.kb`, local
  input applied immediately and reported, replay log per turn), `index.ts` (`createGame(parent, wsUrl)` with `MenuScene` and
  `BoxingScene`), `sfx.ts` (synthesized crowd bed with swells, whoosh, thud, block, parry, dodge, bell, countdown, knockdown, count,
  KO, win, menu blips; unlocked on first key or pointer), `arena.ts` (`ArenaLink`: arena state + events for pages), `ui/kit.ts`
  (text styles, `Panel`, `Button` plank/pill/ghost, `Bar`, `qrImage`, `Toast`, `apiBase`).
- **Sims** (`web/src/game/sims/`, vitest green: `npx vitest run`): `boxing.ts` (positions on a line, facing, reach jab 0.34 / hook
  0.42 / uppercut 0.3, frame data windup/active/recover, guard with 20% chip damage and stamina drain, parry window 0.16 s → stun
  0.9 s and ×1.5 counter, whiffed parry opens 0.45 s, dodge 0.28 s i-frames with 0.7 s cooldown, knockback and stagger, stamina
  fatigue slowing windups, knockdown marks at 50 and 0 with a ten count, KO, 3 × 60 s rounds, 1P/2P/card, two-glove guard),
  `boxerAi.ts` (approach to reach, windup telegraph, guard/back-off, reacts to the human's windup after `reaction_ms`, counters),
  `rhythm.ts` (learner), `bowling.ts` and `baseball.ts` (ports of the Python engines incl. Pin King and Closer), `rng.ts`
  (mulberry32 + gaussian, draw counter), `types.ts` (contract shapes).
- **Scenes:** `scenes/BoxingScene.ts` (ring under spotlights, animated crowd, HUD bars and clock, round cards, 3-2-1, event feed,
  particles, hit-stop, slow-mo, camera shake, keyboard P1/P2), `scenes/BoxerView.ts` (multi-part rig: legs with walk cycle, trunks,
  torso, head, headgear, eyes/brow, gloves posed per state, motion trail, hit flash, stars when stunned), `scenes/MenuScene.ts`
  (title → mode → game → remote with keyboard binding and phone QR → results; plank buttons).
- **Leftover React** (to delete in the rebuild): `main.tsx` routes `/`, `/remote`, `/rail`, `/projector`, `/host`; `projector/`
  (Phaser embedded via `stage/PhaserStage.tsx`, odds board, leaderboard strip, subtitle, banners, card vote splash, audio bus),
  `rail/`, `remote/`, `host/`, `ui/` (plank menu, QR), `lib/store.ts`, `lib/keyboard.ts`, `index.css`. `lib/ws.ts` (`ArenaSocket`),
  `lib/motion.ts`, `lib/fakeMotion.ts`, `protocol.ts` stay.
- Vite: `server.host true`, `allowedHosts true`, proxies `/api`, `/audio`, `/ws` to :8000; the backend serves `web/dist` in
  production mode.

### 3.3 Edge (`cf/`)
Worker `hap`: serves `../web/dist` as static assets (SPA fallback), proxies `/api/*`, `/audio/*`, and `/ws` (WebSocket upgrade
piped both ways) to the backend URL stored in KV `hap-config` (id `5a5eeca4bc9f4d379051e8061562c187`), `/backend/set` admin
endpoint guarded by the `ADMIN_KEY` secret, `scripts/set-backend.mjs`, `.dev.vars` for local dev. Verified locally with
`wrangler dev` on :8787 (health, SPA, WebSocket welcome). `wrangler` 4.131 via npx; `@cloudflare/workerd-linux-64` had to be
installed explicitly because the npm install-scripts policy skipped it. Workers static assets cap files at 25 MiB.

### 3.4 Scripts and tests
- `backend/scripts/`: `fake_remote.py` (phone stand-in: streams synthetic motion over the real socket, `--auto` plays matches,
  boxing patterns, baseball swings on `arrival_ts`), `fake_rail.py` (betting bots, `--sponsor --vote`), `fake_game.py`,
  `hostctl.py` (`seats|snapshot|start|card|send|watch|wait-end`), `headless_sim.py` (`simulate(sport, tier, n)`),
  `replay_match.py`, `rehearsal.sh` (offline bowling → boxing → card with chip conservation), `load_check.mjs`,
  `replay_trace.py`, `gen_synth_traces.py`, `record_trace.py`, `precache_voice.py`, `persona_smoke.py`, `check_protocol.py`, `_client.py`.
- `backend/tests/`: protocol, arena (seq, drops, timers, real-clock jitter p95 < 10 ms), rooms, ws smoke, store, filters, calib,
  detectors (synthetic catalog in `traces/synth/`), market (conservation over 1,000 random rollover chains), games, integration
  bowling, boxing (2 xfail), baseball, m10 (bosses, sponsor, crate, card, pairing, two-glove), persona, tts, bridge, host, store
  audit, backpressure, sim bands (slow). **Current: 129 passed, 2 xfailed.**
- `web`: `npx vitest run` (boxing, bowling, baseball sims), `npm run build` (green).
- Dev servers (`.claude/launch.json`): `backend` (uvicorn :8000, env `HAP_FAST_TIMERS=1 HAP_DEV=1 HAP_ENGINE=client`), `web`
  (Vite :5173), `edge` (wrangler :8787).

## 4. Verified end to end (in the browser or with bots)

- Seat QR claim and rotation; remote page pick-up → calibration → play (synthetic motion); host diagnostics; rail join, bets,
  settlement payouts, leaderboard and titles; bowling and baseball matches over real sockets with the fake phone; the Pixi
  projector (now removed) rendering bowling, boxing, baseball; keyboard boxing on the projector; sponsor warn/apply, crate
  auction, idle card vote into a House-vs-House match; offline persona taunts and voice lines; the edge Worker proxying HTTP and
  WebSocket; the offline rehearsal, load check (12 sockets, 0 drops), backpressure test; **the Phaser flow**: welcome → mode →
  game → keyboard remote → start → round card → 3-2-1 → live boxing with the House landing and blocking.

## 5. Issues met (and the rule each one taught)

1. **Engine churn** (Pixi in React → Godot → Phaser) cost the most time. Decide once: Phaser for everything; never split the UI
   across two frameworks (React + canvas caused duplicate state, two sockets per page, stale module graphs after deletions).
2. **Platform before game.** Rooms, markets, voice, dashboards were solid while boxing was "very broken" when played. Build each
   game as a standalone keyboard-playable scene with tests first; the arena comes after.
3. **Concurrent subagents on one tree**: conflicts, a killed half-rewrite that ended up in HEAD with failing tests, a stale context
   brief. Prefer one executor or strict file ownership with no shared files.
4. **Sequence gaps from dropped messages** made the projector resync in a loop → per-connection seq at send time.
5. **Phone-centric liveness** (frame-gap pause, 20 s unclaimed release) broke keyboard play → keyboard remotes count as alive
   without frames; `motion.calib_done` marks them ready.
6. **React StrictMode** double-mounted sockets and claimed seats twice → the server resumes a seat for the same device with a
   stale token; the client adopts the rotated token; the store dedupes sockets.
7. **Tooling:** the shell's working directory drifts (use absolute paths); Vite needs `allowedHosts: true` for tunnels; a launch
   config edit silently missed after reformatting (verify env actually applied); the in-app browser's key presses do not reach
   Phaser (dispatch `KeyboardEvent`s via JavaScript); Godot needs `--import` before headless `-s` runs; `npm create vite` ran in the
   wrong directory once; deleting files while Vite runs requires a dev-server restart.
8. **No credentials on the machine** (GitHub, Cloudflare, OpenAI, ElevenLabs): plan verification that does not need them and
   hand the user exact commands.
9. **Tests green ≠ playable.** Acceptance must be a human-playable flow from the keyboard with screenshots, plus tests and bots.
10. **Win-rate tuning is seed-sensitive** at 40–60 matches; use bands, not point targets, and the slow test as the gate.
11. **Sim humans must model intent** (aim at the pocket, walk into reach) or tuning is meaningless.
12. **Boxing needed space.** A state machine without positions cannot feel like boxing; reach, windups the opponent can see,
    and knockback are the minimum.

## 6. Rebuild plan: games first, then the platform (in this repo)

Keep `backend/` as the game server. Rebuild `web/` as a pure Phaser + Vite client. Every phase ends with something a person can
play or watch, verified in the browser, with tests.

### Phase 1: Boxing as a standalone game (no server)
- Core: `web/src/game/sims/boxing.ts` (extend; keep vitest green; a test per mechanic). Playable offline: title → 1P/2P →
  ring, keyboard, 3-2-1, three 60 s rounds, knockdown counts, KO, decision, results.
- Boxers: rigs with walk cycle, windup anticipation, punch extension with trails, hit flash, knockback slide, stagger wobble,
  block pose, parry spark, dodge lean, down/KO pose, victory. Particles, hit-stop, slow-motion knockdowns, shake, round cards,
  bell, crowd swells, countdown, KO stinger (synthesized in `sfx.ts`; samples later).
- House AI on the same physics; four tiers from `tiers.yaml`; the boss learns rhythm. Retune boxing tiers against the TS sim.
- Gate: a stranger finishes a match from the printed key hints; headless bot matches land in the bands.

### Phase 2: Bowling and baseball as standalone games
- Sims exist and are tested. Alley and ballpark scenes with keyboard controls, animation and sound to the boxing standard.
- Gate: both playable offline through the same menu; tests green.

### Phase 3: The game-client contract
- Wire `client.ts` to the arena (role `game`) with `HAP_ENGINE=client`; verify with `fake_rail.py` bots, `hostctl.py watch`,
  and the rehearsal script. Gate: a full match with markets settling and voice lines, from the keyboard; backend suite green.

### Phase 4: Platform pages in Phaser
- `/` welcome (game + "Host a game" panel: projector link, host link, rail QR), `/projector` (game viewport + odds board,
  leaderboard strip, seat and rail QRs, subtitles, sponsor/crate/card banners), `/host` (start, seats, toggles, diagnostics,
  params, public/Worker URL; use Phaser DOM elements for text inputs), `/rail` (phone: join, bet cards, stake pills, sponsor
  drawer, crate bid, card vote, bump, leaderboard), `/remote` (phone: pick up, calibrate, play; keyboard/touch fallback).
- Gate: each page verified at desktop and phone sizes; load check and rehearsal pass.

### Phase 5: Deploy and demo
- `vite build` → `cf/` Worker, backend URL in KV, QR codes on the Worker URL; three rehearsals, one offline; demo script from the
  product spec (judge bowls, judge bats, room votes the card, ladder and leaderboard close).

### Working agreements
- One engine, one client codebase, one contract; the arena never simulates a sport.
- vitest per sim, pytest per server module, a headless bot per game, screenshots per UI gate.
- Absolute paths in shell; restart dev servers after deleting modules; never commit or push unless asked.
- Keep `HAP_ENGINE=python` and `scripts/fake_game.py` as the fallback until Phase 3 passes, then delete the Python sport engines.
- Update `docs/AGENT_CONTEXT.md` (stale) or replace it with this brief before spawning any subagent.
