# The House Always Plays — Technical Implementation Plan

Companion to the product spec (`house-always-plays-implementation-plan.md`). The spec says *what*; this says *how*: stack, repo layout, wire protocol, algorithms with starting constants, data schema, and an hour-by-hour task board for four people. Written at H0 (Sep 11, 2026) against an empty repo.

Decisions are stated, not surveyed. Change one only at a gate standup.

---

## 0. Decisions locked at H0

| Area | Decision | Why |
|---|---|---|
| Backend | Python 3.12+ via `uv`, FastAPI + uvicorn, one process, one asyncio loop | Team strength; one writer for all state |
| Frontend | Vite + React + TypeScript, single app, four routes | One build, one origin, fast to iterate |
| Projector stage | PixiJS 8 (npm) | Sprite sheets, ticker, shake and hit-stop are trivial; Canvas 2D is the fallback if nobody has used Pixi |
| Transport | One WebSocket endpoint, JSON envelopes | Simple to debug from the browser console |
| HTTPS | `cloudflared` quick tunnel in front of the Vite dev server | Free, no account, WebSockets pass through, no interstitial page (ngrok free shows one that breaks QR flows) |
| Dev serving | Vite dev server proxies `/api` and `/ws` to uvicorn; tunnel points at Vite | Keeps HMR and one origin so the iOS motion permission is cached once |
| Persistence | SQLite via stdlib `sqlite3`, WAL mode, append-only tables | No ORM to learn; replayable |
| Randomness | One `random.Random(seed)` per match, threaded through sims and policies | Deterministic replays and tests |
| LLM | Anthropic Python SDK, `claude-opus-5`, structured output, `effort: low`, 1.5 s timeout, engine default on any failure | Persona only picks among engine options, so latency and failure never block play |
| Voice | ElevenLabs REST TTS, `eleven_flash_v2_5`, mp3 cached on disk, played only by the projector | Lowest latency model; cache is the offline plan |
| QR | Server mints tokens and join URLs; projector renders QR client-side with the `qrcode` npm package | No image endpoints, regenerates instantly |

---

## 1. Repository layout

```
hackrice/
├── backend/
│   ├── pyproject.toml              # fastapi, uvicorn[standard], pydantic, numpy, openai, httpx, pyyaml
│   ├── app/
│   │   ├── main.py                 # FastAPI app, /ws, /api/*, static mount for prod build
│   │   ├── config.py               # loads config/*.yaml, hot-reload on host command
│   │   ├── protocol.py             # pydantic models for every message (the contract)
│   │   ├── arena.py                # ArenaLoop: intents queue, state, seq, tick scheduling
│   │   ├── state.py                # ArenaState dataclasses + snapshot()
│   │   ├── rooms.py                # devices, seats, tokens, join URLs
│   │   ├── clock.py                # per-device clock offset estimation
│   │   ├── motion/
│   │   │   ├── calib.py            # rest pose, axes, rate check
│   │   │   ├── filters.py          # gravity removal, EMA low-pass, magnitudes
│   │   │   ├── detectors.py        # SwingDetector, ReleaseDetector, PunchDetector, ...
│   │   │   └── worker.py           # per-remote asyncio task: frames in, gestures out
│   │   ├── games/
│   │   │   ├── base.py             # Match, Turn, phases, timers, common events
│   │   │   ├── bowling.py
│   │   │   ├── baseball.py
│   │   │   ├── boxing.py
│   │   │   └── scripted.py         # seeded scenarios per sport
│   │   ├── agents/
│   │   │   ├── policy.py           # Policy protocol, Option, TierConfig
│   │   │   ├── bowler.py / pitcher.py / boxer.py
│   │   │   ├── adaptive.py         # difficulty controller
│   │   │   ├── persona.py          # Claude call, memory, moderation hook
│   │   │   └── bosses.py           # three twists
│   │   ├── market/
│   │   │   ├── ledger.py           # append-only entries, balances
│   │   │   ├── bets.py             # windows, parimutuel settle, rollover
│   │   │   ├── sponsor.py          # moves, caps, crate auction
│   │   │   └── card.py             # agent-vs-agent matchmaking vote
│   │   ├── voice/
│   │   │   ├── triggers.py         # event → (priority, template, persona) mapping
│   │   │   ├── tts.py              # ElevenLabs client + disk cache
│   │   │   └── moderation.py       # blocklist, length cap, name filter
│   │   ├── store/
│   │   │   ├── schema.sql
│   │   │   └── db.py               # single writer thread, batched inserts
│   │   └── host.py                 # host controls handlers
│   ├── config/
│   │   ├── motion.yaml             # thresholds, cooldowns per sport
│   │   ├── tiers.yaml              # 4 opponents × 3 sports
│   │   ├── market.yaml             # stacks, windows, prices, caps
│   │   └── voice.yaml              # voice ids, trigger priorities
│   ├── scripts/
│   │   ├── record_trace.py         # dump a phone's raw stream to JSONL
│   │   ├── replay_trace.py         # run detectors over a trace, print events
│   │   ├── headless_sim.py         # tiers vs. average-human profile, win rates
│   │   └── precache_voice.py       # generate the P4 audio cache
│   └── tests/
│       ├── test_detectors.py       # against traces/
│       ├── test_market.py          # settlement edge cases, conservation
│       └── test_games.py           # determinism, scoring
├── web/
│   ├── package.json  vite.config.ts  tsconfig.json
│   └── src/
│       ├── main.tsx                # router: /remote /rail /projector /host
│       ├── protocol.ts             # hand-written TS mirror of protocol.py
│       ├── lib/ws.ts               # ArenaSocket: seq tracking, resync, reconnect
│       ├── lib/motion.ts           # permission, capture, batching, clock pings
│       ├── lib/store.ts            # useArena() zustand store fed by ws events
│       ├── remote/                 # PickUp → Calibrate → Play screens
│       ├── rail/                   # Join → Bet → Leaderboard
│       ├── projector/
│       │   ├── Projector.tsx       # layout: stage, odds board, strip, QRs
│       │   ├── stage/              # Pixi scenes: BowlingScene, BaseballScene, BoxingScene
│       │   └── audio.ts            # unlock, queue, ducking
│       └── host/                   # controls + diagnostics
├── assets/                         # sprite sheets, sfx, fonts
├── traces/                         # recorded sensor traces (JSONL), committed
├── docs/
└── README.md                       # the H0 bootstrap commands from §16
```

---

## 2. Runtime topology and the dev loop

```
phones ──HTTPS/WSS──▶ cloudflared quick tunnel ──▶ Vite :5173 ──proxy /api,/ws──▶ uvicorn :8000
projector laptop browser ──▶ http://localhost:5173/projector (same server, no tunnel needed)
```

- **Vite config essentials:** `server.host: true`, `server.allowedHosts: true` (Vite blocks unknown hostnames, so the tunnel hostname is refused without this), `server.proxy: { '/api': 'http://localhost:8000', '/ws': { target: 'ws://localhost:8000', ws: true } }`.
- **Tunnel:** `cloudflared tunnel --url http://localhost:5173`. The URL changes on every restart. The host page has a "set public URL" field; the server stores it in `state.public_url` and every join URL is derived from it. Nothing else references the hostname.
- **Offline fallback:** `mkcert` certs for the laptop's hotspot IP, installed on team phones only. Vite serves HTTPS directly via `server.https`. Host page toggles which base URL the QRs use.
- **Production mode (P4 rehearsal):** `vite build` into `web/dist`, FastAPI mounts it, tunnel points at :8000. Same URLs, no Vite in the path.
- **Ports fixed:** 8000 backend, 5173 web. Laptop hotspot address fixed via hotspot DHCP reservation or static IP.

---

## 3. Wire protocol

One endpoint: `wss://<host>/ws?role=remote|rail|projector|host&token=<seat or rail token>&device=<uuid>`.

**Envelope** (both directions):
```json
{"t": "market.window_open", "seq": 8123, "match": "m_04", "ts": 1757600000123, "d": {...}}
```
`seq` is server-assigned, global, monotonic. Client-sent messages carry `t`, `d`, and a client `cseq` for acks; the server ignores anything else. Clients track the last seen `seq`; on a gap they send `session.resync` and the server replies with `session.snapshot` (full `ArenaState.snapshot()` for that role).

**Message catalog (freeze at H1; add, never rename):**

| Direction | Type | Payload |
|---|---|---|
| C→S | `session.hello` | `{role, device_id, token?, nickname?, ua}` |
| S→C | `session.welcome` | `{device_id, role, seat_id?, public_url, server_ts}` + a snapshot |
| C→S | `session.ping` | `{t_client}` → S→C `session.pong {t_client, t_server}` |
| C→S | `session.resync` | `{last_seq}` |
| S→C | `session.snapshot` | full state view for the role |
| C→S | `motion.frame` | see §5.3 |
| C→S | `motion.calib_done` | `{}` (client signals it held still) |
| S→C | `motion.status` | `{device_id, hz, offset_ms, calibrated, last_gesture}` (host + projector, 2 Hz) |
| S→C | `motion.meter` | `{seat_id, mag}` (projector, 15 Hz, for the live swing meter) |
| S→C | `motion.gesture` | `{seat_id, kind, t_phone, power, axis, sign, duration_ms, extra}` |
| S→C | `seat.update` | `{seats: [{seat_id, label, status, join_url, nickname?, avatar?}]}` |
| S→C | `match.start` | `{match_id, sport, seed, human_seats, opponent: {tier, name, voice}}` |
| S→C | `match.phase` | `{turn_no, phase: betting\|input\|resolving\|between, deadline_ts}` |
| S→C | `match.tick` | sport-specific render summary (boxing 20 Hz; bowling/baseball on events) |
| S→C | `match.turn_result` | `{turn_no, outcome, detail, score}` |
| S→C | `match.end` | `{winner, score, ladder_update}` |
| S→C | `agent.decision` | `{agent_id, option_id, source: persona\|default, line?}` |
| S→C | `agent.studying` | `{agent_id, level: 0..1, params_delta}` |
| S→C | `market.window` | `{market_id, kind, outcomes: [{id, label, pool}], closes_ts, open: bool}` |
| C→S | `market.bet` | `{market_id, outcome_id, stake}` → `market.bet_ack {ok, balance, reason?}` |
| S→C | `market.odds` | `{market_id, pools: {outcome_id: chips}}` (throttled to 4 Hz) |
| S→C | `market.settle` | `{market_id, winner, payouts: [{device_id, amount}], rollover}` |
| S→C | `market.leaderboard` | `{rows: [{nickname, chips, titles}]}` |
| C→S | `sponsor.buy` | `{move_id, target}` → `sponsor.ack` |
| S→C | `sponsor.warn` / `sponsor.applied` | `{move_id, target, applies_at_ts}` |
| C→S | `card.vote` | `{pairing_id}` |
| S→C | `voice.line` | `{priority, speaker, text, url, duration_ms}` (projector only) |
| S→C | `sfx.play` | `{name, gain}` |
| C→S | `host.*` | `start, pause, next, force_scenario, set_param, kick, release_seat, lock_seat, set_public_url, reload_config, toggle` |

`protocol.py` holds one pydantic model per type with a `t: Literal[...]` discriminator; `protocol.ts` mirrors it by hand. Both people editing them sit together at H1 for thirty minutes and again at each gate.

---

## 4. Server core

### 4.1 Arena loop
```
async def run():
    while True:
        timeout = next_deadline - now()
        try: intent = await wait_for(intents.get(), timeout)
        except TimeoutError: intent = None
        if intent: handle(intent)          # bet, gesture, host command, persona result
        run_due_timers()                   # betting close, input window close, boxing tick
        flush_events()                     # assign seq, broadcast, enqueue db rows
```
- Everything that mutates `ArenaState` runs inside `handle()` or a timer callback on this task. WebSocket handlers only `intents.put_nowait(...)`.
- Boxing schedules a 50 ms tick timer while a round is live; other sports are event-driven with a few timers.
- `emit(type, d, to=role|device)` appends to an outbox; `flush_events()` stamps `seq` and fans out. Per-connection send queues are bounded (drop `motion.meter` and `market.odds` first when a client is slow).
- Persona calls and TTS calls are `asyncio.create_task` jobs that post their result back as an intent with the `match_id` and `turn_no` they were requested for; stale results are discarded.

### 4.2 State
`ArenaState` holds: `public_url`, `devices{}`, `seats{}`, `ladder{}`, `current_match: Match | None`, `markets{}`, `ledger` (in memory mirror), `queue: list[MatchPlan]`, `config`. `snapshot(role)` returns the role's view (rail never sees seat tokens; remotes never see other phones' offsets).

### 4.3 Store
`db.py` runs a single writer thread with a `queue.Queue`; the arena loop pushes `(table, row)` tuples; the thread batches every 250 ms with `executemany` inside one transaction. Reads for leaderboards use the in-memory mirror, not SQLite.

---

## 5. Rooms, seats, tokens, QR

- **Device id:** generated client-side once, stored in `localStorage`, sent on every hello. Reconnects map to the same device.
- **Seat token:** `secrets.token_urlsafe(12)`, stored on the seat with `status: open|claimed|locked`. Join URL: `{public_url}/remote?seat={seat_id}&tok={token}`. On hello with a valid token for an open seat: claim, mark `claimed`, rotate the token (so the old QR is dead), emit `seat.update`. On invalid or already-claimed: `session.welcome` with `seat_id: null, reason: "taken"` and the remote page shows the "seat taken → scan the rail QR" screen.
- **Rail token:** static per session, URL `{public_url}/rail`. No token needed beyond the device id.
- **Release:** host command, match end, or 20 s without frames from a claimed seat before calibration completes. Release regenerates the token and emits `seat.update`; the projector redraws the QR from `join_url`.
- **Seat sets per mode:** bowling/baseball `[P1]`; boxing one-phone `[P1]`; two-glove `[L, R]` bound to fighter 1; head-to-head `[A, B]`; tag-team `[ACTIVE, BENCH]`. The match plan declares its seat set; `rooms.py` allocates.

---

## 6. Motion pipeline

### 6.1 Client capture (`lib/motion.ts`)
1. Full-screen "Pick up the remote" button. In its click handler, call `DeviceMotionEvent.requestPermission()` and `DeviceOrientationEvent.requestPermission()` when they exist (iOS), then `document.documentElement.requestFullscreen()` (ignore failures on iOS), then `navigator.wakeLock.request('screen')`, then `screen.orientation.lock('landscape')` inside try/catch. Android needs no permission call.
2. Listen to `devicemotion` and `deviceorientation`. Per motion event push `[event.timeStamp, ax, ay, az, agx, agy, agz, rα, rβ, rγ]` using `acceleration` (gravity-free) and `accelerationIncludingGravity` and `rotationRate`; per orientation event store the latest `[alpha, beta, gamma]` and attach it to the next motion sample. Note iOS `interval` is in ms; Android in ms too, but sample rates differ (30–100 Hz). Never rely on the nominal rate.
3. Batch every 50 ms: `motion.frame {t0: first sample timeStamp, n, s: [[...], ...]}`. `event.timeStamp` is milliseconds since `performance.timeOrigin`; send `performance.timeOrigin` once in `session.hello` so the server converts to epoch.
4. Clock sync: five `session.ping` at join then one every 10 s. Offset = median of `t_server - (t_client + rtt/2)`.
5. Detached socket: buffer up to 2 s of frames, reconnect with the same token, resend.

### 6.2 Calibration (`motion/calib.py`)
- **Rest pose (2 s):** mean and std of `accelerationIncludingGravity` gives gravity vector `g` and noise floor `σ_rest` (on |acceleration|). Store `a_thr = max(cfg.min_swing_ms2, mean|a_lin|_rest + 8·σ_rest)`.
- **Axis fix ("raise the phone", 1 s):** the axis with the largest signed change in `accelerationIncludingGravity` from rest is `forward`; its sign is stored. Long axis for spin is the phone's y axis by construction.
- **Rate check:** `hz = n_samples / (t_last - t_first)` over the first 5 s; detectors compute window sizes in samples from `hz`.
- Calibration is per device and survives reconnect. Recalibrate on host command or if `hz` changes by more than 30%.

### 6.3 Preprocessing (`motion/filters.py`)
- Prefer `acceleration` (gravity-free) from the browser. If a device reports it as null (some Androids), compute `agx - g` using the calibrated gravity in the phone frame, which is only valid at rest pose but fine for magnitude peaks.
- EMA low-pass with `α = 0.5` at 60 Hz (scale by `60/hz`), on each axis.
- Per sample compute `|a|`, `|ω|`, forward component `a_fwd`, tilt `beta`/`gamma`.

### 6.4 Detectors (`motion/detectors.py`) — state machines, starting constants in `motion.yaml`

**Swing** (bowling, baseball):
```
IDLE ──|ω|>ω_arm for ≥arm_ms──▶ ARMED ──|a|>a_thr──▶ PEAK(track max, t_peak, axis) ──|a|<0.4·max or 250ms──▶ EMIT ──▶ REFRACTORY(cooldown) ──▶ IDLE
```
Starting values: `ω_arm = 90 °/s`, `arm_ms = 40`, `a_thr = max(12 m/s², calibrated)`, cooldown bowling 600 ms, baseball 450 ms. Output: `t_peak` (phone time), `power = clamp((max - a_thr)/(a_sat - a_thr), 0, 1)` with `a_sat = 35 m/s²`, dominant rotation axis and sign at peak, `duration_ms`.

**Release** (bowling, runs inside the swing's PEAK/decay): first sample after `t_peak` where `a_fwd` crosses zero while `|beta| < 25°` from vertical. `spin = ω_long at release` (°/s, signed), `lane = clamp(mean(gamma) over 400 ms before ARMED / 30°, -1, 1)`, `speed = power`. If no zero-crossing within 300 ms, release at `t_peak + 120 ms`.

**Punch** (boxing): `a_fwd > 10 m/s²` reached within 80 ms of leaving `|a| < 3`; `hook` if `|ω_yaw|` peak > 250 °/s during the spike, else `jab`. Cooldown 180 ms. `power` as above with `a_sat = 30`.

**Block:** `|a| < 1.5 m/s²` and `|beta - 90°| < 20°` (upright) for 200 ms → `block_on`; leaves when either condition fails for 100 ms → `block_off`.

**Dodge:** `|Δgamma| > 30°` within 150 ms with no forward spike in that window. Cooldown 400 ms.

**Shake:** ≥ 3 peaks above `0.6·a_thr` within 1 s. **Flick:** single spike < 120 ms with sign reversal of `a_fwd` within 100 ms. **Bump:** spike `|a| > 25 m/s²` with duration < 60 ms (see §9.4).

Every emitted gesture carries `t_phone` (phone clock) and `t_server = t_phone + offset` so engines compare against arrival times on the server timeline.

### 6.5 Worker (`motion/worker.py`)
One asyncio task per remote: consumes that device's frame queue, runs filters and the sport's detector set (selected by the current match), emits `motion.gesture` intents to the arena queue, and publishes `motion.meter` at 15 Hz and `motion.status` at 2 Hz. CPU is negligible at 60 Hz per phone; no processes.

### 6.6 Failure handling
- No frames for 1.5 s on a claimed seat during an input window → projector `reconnect` badge, match pauses at the next safe point (never mid-pitch; boxing pauses immediately).
- No swing by the end of an input window → `no_swing` outcome (gutter ball, called strike, no punch), never a stuck match.

---

## 7. Match framework and sport engines

### 7.1 Framework (`games/base.py`)
```
class Match:
    sport, match_id, seed, rng, seats, opponent, turns: list[Turn], turn_no, phase
    def plan_turn() -> TurnPlan         # what markets to open, input window length, whose input
    def on_gesture(seat, gesture)       # engine input
    def on_agent_decision(agent, opt)   # engine input
    def resolve() -> TurnResult         # pure function of collected inputs + rng
    def render_summary() -> dict        # for match.tick
```
Turn lifecycle (all timers via the arena loop): `betting (cfg.window_s, default 12 s)` → `input (sport-specific)` → `resolving (animation length reported by the engine, e.g. 2.5 s ball roll)` → `between (2 s)` → next turn. Betting for turn *n+1* opens during *between* so the room is never idle.

### 7.2 Bowling (`games/bowling.py`)
- Inputs: `lane ∈ [-1,1]`, `speed ∈ [0,1]`, `spin ∈ °/s`, handedness sign `h`.
- Ball path in lane units, `d ∈ [0,1]` from foul line to pins:
  `x(d) = lane + 0.15·lane_drift + h·k_hook·clamp(spin/400, -1, 1)·(1 - speed·0.5)·d²`, with `k_hook = 0.8`. Entry `x_e = x(1)`, entry angle `θ_e = atan(dx/dd at d=1)`.
- Gutter if `|x_e| > 0.92` at any `d`.
- Pin-fall table keyed by `(pocket_error, θ_e, speed)`, `pocket = h·0.28`, `pocket_error = |x_e - pocket|`:

| pocket_error | strike p | else |
|---|---|---|
| < 0.06 | 0.80 + 0.1·speed | leaves 1–2 pins (10, 7, or 3-6) |
| 0.06–0.15 | 0.40 | leaves 2–4, spare-able |
| 0.15–0.30 | 0.10 | 4–7 pins, split chance 0.25 |
| head-on `|x_e| < 0.05` | 0.20 | split 7-10 or 4-6 with p 0.35 |
| > 0.30 | 0 | 1–4 pins |

  Second ball: remaining pins with a simpler hit test (each standing pin falls with p based on `|x_e - pin_x|`). Draw everything from `match.rng`.
- Scoring: standard ten-pin with frames; `quick` mode = 5 frames. Engine exposes `frame_state` for the renderer and `outcome ∈ {strike, spare, open, gutter}` for the market.
- House bowler: `bowler.py` draws `(lane, speed, spin)` from the tier's `N(mean, σ)` and rolls through the same path function.

### 7.3 Baseball (`games/baseball.py`)
- Pitch set in `tiers.yaml`: `{fastball: {travel_ms: 900, break: 0}, changeup: {1250, 0}, curve: {1100, -0.4}, high/low/inside/outside: location offsets}`. `match.tick` sends `{pitch, release_ts, arrival_ts}` once; the projector animates flight from timestamps so network jitter never moves the ball.
- Contact: `Δt = t_swing_server - arrival_ts`. Hit if `|Δt| ≤ W` where `W` is per tier (Rookie 110 ms, Contender 90, Champion 75, Boss 60). `quality = (1 - |Δt|/W) · (1 - 0.6·|swing_pitch_angle - pitch_height|)` with angles normalized to [0,1].
- Direction: `dir = clamp(-Δt/W + 0.3·rot_sign, -1, 1)` (early pulls, late goes opposite). Distance: `dist = power · (0.4 + 0.6·quality)`.
- Outcome lookup: `quality < 0.25 → foul (p 0.6) or out`; `0.25–0.5 → out (0.55) / single`; `0.5–0.75 → single (0.5) / double (0.3) / out`; `> 0.75 and dist > 0.8 → home run`, else double. Three outs per half, three innings in quick mode; the House bats with its own timing distribution.
- Pitcher reading: `pitcher.py` keeps the human's last 6 `Δt` values and swing rate (swings per pitch). Options list = all legal pitches; the default choice biases toward changeup when mean `Δt < -30 ms` (early), fastball when late, and a called-strike location when swing rate is low.

### 7.4 Boxing (`games/boxing.py`)
- Tick 50 ms. Fighter: `hp 100, stamina 100, guard: bool, state ∈ {idle, telegraph, strike, recover, block, dodge, down}` with `state_until` tick.
- Human punch: applied at the next tick if stamina ≥ 10; damage `= 8 + 10·power` (hook ×1.4), stamina −10 (hook −16). Blocked → damage ×0.2. Dodged (opponent in `dodge` state within the last 300 ms) → 0. Stamina regen 4/s idle, 8/s while blocking.
- House boxer state machine, parameters per tier: `aggression` (p to start telegraph per second), `telegraph_ms` (Rookie 600 → Boss 250), `reaction_ms` (time from human punch start to block decision), `pattern` (list of punch types cycled with noise), `dodge_p`.
- Knockdown when `hp` crosses 50 or 0: `down` state 3 s, projector slow-motion flag on `match.tick`. Rounds 30 s × 3; winner by KO or `hp` total.
- Two-glove: seat L feeds only jabs/hooks tagged `hand: L`, seat R `hand: R`; `guard` requires both seats' `block_on`. Same engine, gestures carry `seat_id`.
- Agent-vs-agent: both fighters run the state machine with tick interval slowed to 80 ms for watchability; no human input path.

### 7.5 Scripted scenarios (`games/scripted.py`)
A scenario is `{seed, overrides}`: bowling pins the pin-table draw for frames 1 and 3 to "strike if pocket_error < 0.15"; baseball fixes the pitch sequence `[fastball, fastball, changeup, fastball, curve]`; boxing scripts the House boxer's first 20 s (`telegraph → strike → recover` with a wide window at t=12 s for a knockdown). Human input still flows through the normal detectors.

---

## 8. Opponent agents

### 8.1 Interfaces (`agents/policy.py`)
```
@dataclass class Option: id: str; label: str; params: dict; ev: float
class Policy(Protocol):
    def options(self, state, rng) -> list[Option]     # engine-legal, ranked by ev
    def default(self, options) -> Option              # top ev with tier noise
class TierConfig: name, sport, params: dict, voice_id, persona_prompt, taunts: list[str], portrait
```
Arena flow per agent decision: `opts = policy.options(...)`; `emit agent.decision(default)` immediately only if `persona.enabled` is false; otherwise start the persona task with a 1.5 s deadline and fall back to `default` on timeout, invalid id, exception, or a `refusal` stop reason. The chosen option is logged with `source`.

### 8.2 Persona (`agents/persona.py`)
```python
class PersonaChoice(BaseModel):
    option_id: str
    line: str            # ≤ 90 chars, PG-13

client = anthropic.AsyncAnthropic()
async def choose(tier, state_summary, options, memory) -> PersonaChoice | None:
    resp = await asyncio.wait_for(client.messages.parse(
        model="claude-opus-5",
        max_tokens=300,
        output_config={"effort": "low"},
        system=tier.persona_prompt + RULES,          # stable prefix, cache_control on it
        messages=[{"role": "user", "content": json.dumps({"state": state_summary, "options": [o.id for o in options], "memory": memory})}],
        output_format=PersonaChoice,
    ), timeout=1.5)
    if resp.stop_reason == "refusal": return None
    return resp.parsed_output
```
- System prompt is the stable prefix (persona, rules, taunt bank) with a `cache_control` breakpoint; the per-turn JSON is the only volatile part.
- Thinking is on by default on Opus 5; `effort: low` keeps it short. If measured p95 latency exceeds 1.2 s in P2, switch the model string to `claude-haiku-4-5` in `tiers.yaml` (no code change).
- Memory: `persona_memory[(agent, nickname)] = {results: [...], moment: str, last_line: str}` capped at 5 entries, included in the JSON.
- `line` passes `moderation.py` (blocklist, 90 chars, strip anything matching a display name other than the opponent's) before it reaches voice.

### 8.3 Adaptive difficulty (`agents/adaptive.py`)
Per human per sport: `success_rate` (EMA α=0.3 of turn success), `streak`, `t_since_success`. Every turn: `err = success_rate - target (0.5)`; nudge one parameter per sport by `-k·err` (`k = 0.15`) toward making the House worse when the human is losing: bowling `σ_lane`, baseball `W`, boxing `reaction_ms`. Clamp to the tier's `[min, max]`. Emit `agent.studying {level: |cumulative nudge| / max nudge}`. Never nudge on turns affected by a sponsor move.

### 8.4 Boss twists (`agents/bosses.py`, in build order)
1. **Rhythm learner (boxing):** ring buffer of the last 8 inter-punch intervals and punch types; once `std(intervals) < 120 ms` and ≥ 5 samples, predict the next punch at `last + mean` and enter `block` (or `dodge` if the predicted type is the human's preferred) 100 ms before it, then counter. `agent.studying.level = 1 - std/300`. Reset if the last interval deviates by > 40%.
2. **Pin King (bowling):** `lane_drift` changes each frame (`rng.uniform(-0.3, 0.3)`), shown as an oil pattern on the lane; on one scripted frame the pin set is re-racked to a 7-10 split during the input window (`match.tick {rerack: true}`).
3. **The Closer (baseball):** sudden-death three strikes; pitch set gains `knuckle` with `break = rng.uniform(-0.5, 0.5)` applied at 70% of flight; the market seeds the House outcome pool with a visible House stake.

---

## 9. Market

### 9.1 Ledger (`market/ledger.py`, table `ledger`)
`(id, device_id, delta, reason, ref_id, ts)`; balance = `SUM(delta)`; in-memory `balances{}` maintained alongside. Reasons: `join_grant, bet_place, bet_payout, bailout, sponsor_buy, crate_bid, crate_refund, transfer_in, transfer_out, host_adjust`. Starting stack 500, min bet 10, bailout 100 when balance < 10 and last bailout > 60 s ago.

### 9.2 Bets and settlement (`market/bets.py`)
- `Market {id, match_id, turn_no?, kind, outcomes, pools{}, bets[], status: open|closed|settled|void, rollover_in}`.
- Place: validate window open, stake ≥ min, stake ≤ balance; ledger `bet_place -stake`; add to pool; emit `market.odds` (throttled).
- Settle with winner set `Wn` (one or more outcomes for ties): `pool = Σ all stakes + rollover_in`; `win_pool = Σ stakes on Wn`; if `win_pool == 0` → rollover `pool` into the next market of the same match (or void-refund at match end); else each winning bet pays `floor(stake · pool / win_pool)`; remainder `pool - Σ payouts` becomes `rollover_in` of the next market. Ties: split `pool` across winning outcomes evenly first, then pro rata within each.
- Void (cancelled turn, disconnect before input): refund every stake at face value.
- Invariant asserted after every settle: `Σ ledger deltas for this market + rollover_out == 0`.
- Markets per turn: `match_winner` opened at match start, closes at the first input window; `turn_outcome` per turn (bowling `strike/spare/open`, baseball `hit/out`, boxing `round_winner`).

### 9.3 Sponsor moves (`market/sponsor.py`)
`moves.yaml`: `{id, target: house|human, effect: {param: delta} | {grant: extra_frame|second_wind}, base_price, cap_per_match, cooldown_s, warn_s: 2}`. Price `= base_price · (1 + 0.8·advantage_of_target)` where advantage is the market's implied probability of the target minus 0.5, clamped to `[0.5×, 2×]`. Sum of `|effect|` applied in a match is capped at `cfg.max_swing` (a fraction of the parameter's tier range, default 0.35). Applying: ledger debit, `sponsor.warn`, timer `warn_s`, then the engine applies and emits `sponsor.applied`. Crate: every 4 turns, pick a random move, open a 15 s sealed-bid window; highest bid debited, others refunded.

### 9.4 Bump pairing (`market/…` shared helper `pairing.py`)
The worker emits `bump` gestures with `t_server`. A pairing request (`host.pass_seat`, `rail.transfer`, `bind_glove`, `tag`) opens a 5 s window; the first two bumps within 150 ms of each other on the server timeline are paired; three or more → `re-bump` prompt. Only devices that requested pairing (or the seat being passed to) are eligible, which removes most crowd ambiguity.

### 9.5 Card (`market/card.py`)
When no seat is claimed for 20 s or on host command: offer two pairings from the boxing tier list, 15 s `card.vote`, majority wins (rng tie-break), `match.start` with `human_seats: []`, standard betting.

---

## 10. Voice and audio

- `triggers.yaml` maps engine events to `{priority, speaker, template_key, persona_line: bool}`. Priorities: 3 knockdown/strike/home run/boss twist, 2 upset/big payout, 1 turn results.
- Pipeline: event → if `persona_line`, use the persona's `line` from the same decision (no second LLM call) else fill a template with the event fields → moderation → `tts.py`.
- `tts.py`: key `sha1(voice_id + text)`; if `assets/audio/cache/{key}.mp3` exists, return its URL immediately; else POST `https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128` with `{text, model_id: "eleven_flash_v2_5"}` and header `xi-api-key`, write the file, return the URL. Timeout 3 s; on failure play the priority's fallback template clip from the cache.
- One line in flight: the projector's `audio.ts` keeps a queue of max 1 pending; a new higher-priority line replaces the pending one; lines older than 6 s are dropped.
- Projector audio unlock: host clicks "Unlock audio" on the projector page once (plays a silent buffer). SFX via a single `AudioContext` with a gain node ducked to 0.3 while a voice line plays.
- `precache_voice.py` (P4): for each persona, generate the taunt bank plus 20 templated lines per priority-3 trigger.

---

## 11. Frontend

- **`lib/ws.ts`:** `ArenaSocket(role, token)` with auto-reconnect (exponential backoff capped at 3 s), `seq` gap detection → `session.resync`, and an `on(type, handler)` bus.
- **`lib/store.ts`:** zustand store; reducers per message type; `snapshot` replaces the whole slice. Every page is a pure function of the store.
- **Remote page:** three screens. `PickUp` (button only) → `Calibrate` (hold still bar, raise-phone prompt, driven by `motion.status`) → `Play` (sport prompt, big swing meter from local `|a|` so it feels instant, turn phase and countdown from the store, full-screen flash on gesture ack). No text smaller than 24 px; landscape only.
- **Rail page:** nickname pick (8 presets + field) → market list (one-tap default stake 25, slider 10–200) → balance, leaderboard drawer, sponsor drawer, crate bid sheet.
- **Projector page:** React layout shell with a Pixi `<canvas>` for the stage. Layout: stage center, odds board top-right (flip digits, pools as ratios), leaderboard strip bottom, subtitle above the strip, studying meter beside the opponent, nameplates with QR (rendered by `qrcode` at 320 px so it scans from 8 m) or nickname/avatar. Pixi scenes swap on `match.start`; each scene reads `match.tick` summaries and never simulates. Screen shake, hit-stop, and slow motion are scene-level effects keyed by flags in the tick.
- **Host page:** buttons for every `host.*` message, public URL field, param sliders bound to `config`, diagnostics table (per device: hz, offset, last gesture, socket state), a "force scenario" dropdown, an "unlock audio" reminder.

---

## 12. Persistence schema (`store/schema.sql`)

```sql
devices(device_id PK, role, nickname, ua, first_seen, last_seen)
seats(seat_id, match_id, device_id, claimed_ts, released_ts)
matches(match_id PK, sport, seed, opponent_tier, scenario, started_ts, ended_ts, winner)
turns(match_id, turn_no, phase_ts_json, outcome, detail_json)
gestures(id PK, match_id, turn_no, device_id, kind, t_phone, t_server, power, axis, sign, duration_ms, extra_json)
motion_frames(device_id, t0, samples_json)          -- only while host "record traces" is on
agent_decisions(match_id, turn_no, agent_id, option_id, source, latency_ms, line)
ledger(id PK, device_id, delta, reason, ref_id, ts)
bets(bet_id PK, market_id, device_id, outcome_id, stake, ts)
markets(market_id PK, match_id, turn_no, kind, winner, pool, rollover_in, rollover_out, settled_ts)
sponsor_moves(id PK, match_id, turn_no, device_id, move_id, target, price, applied_ts)
voice_lines(id PK, match_id, speaker, priority, text, cache_key, requested_ts, played_ts)
```
Replay = `matches.seed` + `gestures` + `agent_decisions`; `replay_trace.py` and the tests consume exactly these.

---

## 13. Configuration, run modes, host controls

- All YAML under `backend/config/` loads into one `Config` pydantic model; `host.reload_config` re-reads from disk; `host.set_param {path, value}` patches in memory and writes back.
- Run modes via env `HAP_MODE=normal|offline|scripted|headless`: offline disables persona and TTS network calls (cache only); scripted forces scenarios on every match; headless skips the WebSocket server entirely (used by `headless_sim.py` and tests).
- Secrets: `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY` in `backend/.env`, loaded by `uv run --env-file`.

---

## 14. Tests and scripts

- `traces/` holds JSONL: one line per `motion.frame` plus a header with device model, hz, and label (`bowling_swing`, `baseball_swing`, `punch_jab`, `punch_hook`, `block`, `dodge`, `walk`, `fidget`). Record with `record_trace.py --label ... --seconds 15` while the host page has "record traces" on. Target by P4: four people × two platforms × ten reps per gesture.
- `test_detectors.py`: for each labeled positive trace, exactly one gesture of that kind; for each negative trace, zero. Report recall and false-positive count; CI gate at 95% recall.
- `test_games.py`: same seed + same gesture list → identical `TurnResult`s; scoring tables (a known 12-strike sequence scores 300; a spare then 5 scores 15).
- `test_market.py`: no winning backers → rollover; tie split; void refund; conservation invariant on 1,000 random markets.
- `headless_sim.py`: an "average human" profile per sport (bowling `lane ~ N(0, 0.2)`, `speed ~ N(0.6, 0.15)`, `spin ~ N(150, 100)`; baseball `Δt ~ N(-20, 60)`; boxing punch interval `~ N(900, 200)`), 200 matches per tier; assert human win rate per tier lands in `[0.6, 0.8]`, `[0.45, 0.6]`, `[0.3, 0.45]`, `[0.15, 0.3]` and that adaptive nudges converge within 4 turns.
- Load check (P3): a Node script opens 12 rail sockets placing bets every 5 s while two `replay_trace.py --live` remotes stream; projector frame time stays under 20 ms (Pixi ticker stats on the host page).

---

## 15. Task board by phase and owner

Owners: **M** motion & engines, **B** backend & market, **F** frontend & art, **A** agents, voice & demo. Interface freeze points are where two owners must sit together.

### P0 — Kernel (H0–H6)
| H | M | B | F | A |
|---|---|---|---|---|
| 0–1 | Bootstrap (§16), first motion page that logs `devicemotion` on both phones over the tunnel | `protocol.py` catalog, `arena.py` skeleton with intents + seq, `/ws` | Vite app, routes, `ws.ts`, `store.ts`, `protocol.ts` mirror | Keys in `.env`, one ElevenLabs line saved to disk, `tts.py` cache function |
| **1** | **Freeze: protocol catalog (B + F), frame format (M + F)** | | | |
| 1–3 | `motion.ts` capture + batching + pings; `calib.py`; `filters.py`; `SwingDetector` | `rooms.py` seats/tokens/join URLs, `session.*`, snapshot/resync, `db.py` writer + `schema.sql` | Remote `PickUp` + `Calibrate`, projector shell with seat QRs and rail QR, `motion.meter` swing bars | `ledger.py` join grant + balances (A takes this so B stays on rooms), `tiers.yaml` for bowling with four parameter sets |
| 3–6 | `record_trace.py`, first traces from all four teammates, tune `a_thr`/cooldown until walking is silent | `motion.status` to host, host page endpoints, `flush_events` backpressure | Host page diagnostics table, rail join screen | `voice.line` → projector `audio.ts` playback with unlock |
| **6** | **Gate:** two phones ≥ 50 Hz, one clean swing event, live meters on projector | | | |

### P1 — Bowling + Rail (H6–H14)
| H | M | B | F | A |
|---|---|---|---|---|
| 6–10 | `base.py` match framework, `bowling.py` path + pin table + scoring, `ReleaseDetector` | `bets.py` windows + parimutuel + rollover + void, `market.*` messages, `test_market.py` | `BowlingScene` (lane, ball, pins, score strip), odds board with flip digits, rail bet screen | `bowler.py` tiers, `policy.py` interfaces, `triggers.yaml`, announcer templates |
| **8** | **Freeze: `TurnResult` and `match.tick` shape for bowling (M + F), market outcome ids (B + F)** | | | |
| 10–14 | Full 5-frame match vs. House end to end, no-swing timeouts, reconnect resume | Leaderboard + titles, bailout, `ladder{}` | Leaderboard strip, versus splash, payout SFX, remote `Play` screen | Persona call wired (§8.2) for the bowler, moderation, first taunts spoken |
| **14** | **Gate:** stranger bowls unaided; ten phones bet and get paid; a spoken line plays | | | |

### P2 — Baseball + Adaptive + Card (H14–H20)
| H | M | B | F | A |
|---|---|---|---|---|
| 14–18 | `baseball.py` timing windows, `test_games.py` determinism, arrival-timestamp alignment | `card.py` vote + agent-vs-agent match plan, `adaptive.py` plumbing (params patch path), `scripted.py` loader | `BaseballScene` (pitch flight from timestamps), ladder screen, studying meter, card vote UI on rail | `pitcher.py` reading logic, `adaptive.py` controller, persona memory, boxer tiers config |
| 18–20 | Tune `W` per tier with three different people | `headless_sim.py` win-rate bands | Baseball hit VFX, home-run stamp | Card commentary between rounds, cached template clips for priority-3 triggers |
| **20** | **Gate:** baseball fair for three people; studying meter moves; a card runs and settles | | | |

### P3 — Boxing + Bosses + Sponsor moves (H20–H26)
| H | M | B | F | A |
|---|---|---|---|---|
| 20–24 | `boxing.py` + `PunchDetector`/block/dodge, 50 ms tick, one-phone mode | `sponsor.py` moves, caps, warn timer; crate auction; `pairing.py` bump | `BoxingScene` with health/stamina bars, telegraph poses, knockdown slow-mo; sponsor drawer | Rhythm-learner boss (§8.4.1), boss persona hooks, Pin King oil pattern |
| 24–26 | Two-glove binding, bump-to-pass | Load script (§14), backpressure check | Boss VFX, crowd states | The Closer, `precache_voice.py` first run |
| **26** | **Gate:** boxing round registers punches/blocks; one boss twist legible in 5 s. Cut rule: if P1 slipped past H16, P3 = boxing card only | | | |

### P4 — Polish + Freeze (H26–H28)
| Everyone | Three full rehearsals on the real projector with the real phones, one with internet off (`HAP_MODE=offline`); `vite build` + FastAPI static mode; lock thresholds; Devpost text and fallback video (A). No new features after H26. |
|---|---|

---

## 16. H0 bootstrap (run in this order)

```bash
# tools
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb && sudo dpkg -i /tmp/cloudflared.deb
```
```bash
# backend
mkdir -p backend && cd backend && uv init --name hap --python 3.12 && uv add fastapi "uvicorn[standard]" pydantic numpy anthropic httpx pyyaml python-dotenv && uv add --dev pytest
```
```bash
# frontend
cd /home/surya/repos/hackrice && npm create vite@latest web -- --template react-ts && cd web && npm i && npm i zustand pixi.js qrcode react-router-dom && npm i -D @types/qrcode
```
```bash
# run (three terminals)
cd /home/surya/repos/hackrice/backend && uv run --env-file .env uvicorn app.main:app --port 8000 --reload
```
```bash
cd /home/surya/repos/hackrice/web && npm run dev -- --host
```
```bash
cloudflared tunnel --url http://localhost:5173
```

First-hour acceptance, in order: tunnel URL opens on an iPhone in Safari and an Android in Chrome; the permission tap grants motion on iOS; the server prints ≥ 50 Hz for both; one bowling swing prints one event and ten seconds of walking prints none. Everything in §15 assumes these four are true by H1.
