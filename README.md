# The House Always Plays

Phone-as-motion-remote sports (bowling, baseball, boxing) on a projector, against AI House opponents, with a play-chip
betting rail for every other phone. Spec: `docs/house-always-plays-implementation-plan.md` (product) and `docs/TECH_PLAN.md`
(technical). Build history and agent rules: `docs/AGENT_CONTEXT.md`.

Pages (same app, four routes): `/projector` (the big screen), `/host` (controls and diagnostics), `/rail` (spectators bet),
`/remote?seat=P1&tok=…` (a phone's motion remote; scan a seat QR on the projector or copy the join URL from `/host`).
Add `&fake=1` to a remote URL on a laptop for synthetic motion; press **Enter** on the projector to play with the keyboard.

## Run modes

### Development (three terminals)
```bash
cd backend && uv run --env-file .env uvicorn app.main:app --port 8000 --reload
```
```bash
cd web && npm run dev -- --host          # Vite :5173 proxies /api and /ws to :8000
```
```bash
# human step: gives phones an HTTPS origin (required for motion sensors). Paste the printed URL into the host page.
# Wrangler downloads cloudflared itself; no sudo needed. Plain `cloudflared tunnel --url http://localhost:5173` also works.
npx wrangler tunnel quick-start --url http://localhost:5173
```

### Production (one process, no Vite)
```bash
cd web && npm run build                                   # writes web/dist
cd backend && uv run --env-file .env uvicorn app.main:app --port 8000
```
FastAPI serves `web/dist` (`/projector`, `/host`, `/rail`, `/remote`), the audio cache at `/audio`, and the WebSocket on the
same origin (`/ws`). Point the tunnel (or the Cloudflare Worker, below) at `:8000`. `scripts/rehearsal.sh` runs this mode.

### Edge front door (stable URL for the QR codes)
`cf/` holds a Cloudflare Worker that serves `web/dist` at `https://hap.<account>.workers.dev` and proxies `/ws`, `/api/*`,
`/audio/*` to the laptop's tunnel URL stored in KV. Deploying needs the user's `wrangler login`; see `cf/README.md`. The host
page has an "Edge Worker backend" form (`host.set_backend_url`) that POSTs the tunnel URL to the Worker's `/backend/set`,
so when the tunnel URL changes only that field changes.

## Godot first-person phone game

The standalone Godot project is now a playable first-person golf range. It
accepts two low-latency Wii-style phone controllers: calibrated phone tilt
aims the camera and golf swing power launches a physics ball. Start it with:

```bash
godot --path godot
```

With the Vite server and HTTPS tunnel above running, open
`https://<tunnel>/controller?player=1` and
`https://<tunnel>/controller?player=2` on the phones. Arrow keys provide a
desktop aim fallback. Full setup, telemetry details, and tuning guidance are in
[`docs/PHONE_CONTROLLER.md`](docs/PHONE_CONTROLLER.md).

Golf shots also call the backend commentator. `OPENAI_KEY` generates a fresh
short reaction and `ELEVENLABS_API_KEY` voices it; missing keys fall back to
local lines and subtitles without blocking gameplay.

### Environment knobs (`backend/.env`, see `.env.example`)
| Variable | Effect |
|---|---|
| `HAP_MODE=normal\|offline\|scripted\|headless` | offline: no persona/TTS network calls (taunt bank + cached audio only); scripted: every match uses the sport's demo scenario; headless: no store (tests/sims) |
| `HAP_FAST_TIMERS=1` | short windows for unattended runs (betting 0.4 s, between 0.2 s, boxing rounds 6 s; `FAST_TIMER_OVERRIDES` in `app/config.py`) |
| `HAP_DEV=1` | enables `/remote?…&fake=1` synthetic motion and the desktop dev bar |
| `HAP_PUBLIC_URL` | base URL baked into QR codes at boot (the host page can change it live) |
| `HAP_DB` | SQLite path override (default `backend/hap.db`; `rehearsal.sh` uses a private file) |
| `OPENAI_KEY`, `ELEVENLABS_API_KEY` | optional; without them the offline persona and cache-only voice are used |

## Keyboard controls (projector page, after pressing Enter to claim the open seat)
| Sport | Keys |
|---|---|
| Bowling | `←` `→` aim, `A` / `D` spin, hold `Space` to charge, release to roll |
| Baseball | `Space` swing, `↑` / `↓` swing height |
| Boxing | `J` jab, `K` hook, hold `Space` block, `P` parry, `A` / `D` dodge |

The desktop remote (`/remote?seat=P1&tok=…&fake=1`) offers the same actions as buttons and keys.

## Host page (`/host`)
Start any sport with a tier and optional seed, force a scripted scenario, run Fight Night (agent vs agent card), pause /
resume / end, pick the seat set (single, two-glove, head-to-head, tag-team), set the public URL, point the Worker at this
laptop, flip toggles (persona, TTS, record traces, sponsor moves, idle card). **Parameters**: quick sliders for the motion
thresholds and market windows, plus a generic editor over every numeric config leaf (`motion`, `market`, `tiers` per sport
and tier, `game`, `voice`). Changes apply live (motion detector sets rebuild; market windows are read per turn; tier params
apply at the next match) and the changed leaf is written back to `backend/config/<section>.yaml` (YAML comments in that
file are not preserved). "Reload config from disk" re-reads all YAML. **Diagnostics**: arena timer jitter p95, projector
frame-time p95 and fps (sent by the projector every 5 s), per-socket queue depth and dropped-message counts, market counts,
per-phone hz / clock offset / calibration / last gesture, and a rolling event log.

## Verify
```bash
cd backend && uv run pytest -q -m "not slow"          # unit + integration (headless arena, FakeClock)
cd backend && uv run pytest -q -m slow                # win-rate bands per tier (headless_sim, 40 matches each)
cd backend && uv run python scripts/check_protocol.py # protocol.py <-> protocol.ts drift guard
cd web && npm run build
backend/scripts/rehearsal.sh                          # unattended: offline backend on :8103, bowling -> boxing -> card, ledger audit
node backend/scripts/load_check.mjs --url ws://localhost:8103 --n 12 --seconds 60   # 12 betting sockets + diagnostics
uv run python backend/scripts/replay_match.py --list && uv run python backend/scripts/replay_match.py m_1   # replay from the store
```
`replay_match.py` rebuilds a match from `matches.seed` + `gestures` + `agent_decisions` (+ `sponsor_moves`) and diffs every
turn against `turns.outcome`; bowling replays are exact for any recording, baseball/boxing are exact for headless recordings
and best-effort for wall-clock ones (their outcomes depend on server-timeline timing).

Useful scripts (`backend/scripts/`): `fake_remote.py` (a phone stand-in; `--auto` plays matches), `fake_rail.py` (betting
bots), `hostctl.py` (`seats | start | card | send | watch | wait-end`), `headless_sim.py` (win rates per tier),
`replay_trace.py` / `record_trace.py` / `gen_synth_traces.py` (motion traces), `precache_voice.py`, `persona_smoke.py`.

## Human-only steps (need real phones or accounts)
1. HTTPS origin: run the quick tunnel above (or `cloudflared`), or `mkcert` certs for the hotspot IP installed on team phones.
2. iOS: the motion permission prompt only appears after a user tap in Safari; the remote's "Pick up the remote" button does it.
3. Threshold tuning: record real swings with `uv run python scripts/record_trace.py --label bowling_swing --seconds 15`
   (host toggle "record traces" on), replay with `scripts/replay_trace.py`, then adjust `motion.yaml` (`swing.omega_arm_dps`,
   `swing.a_sat_ms2`, `punch.a_fwd_ms2`, cooldowns) from the host page sliders until walking is silent and every swing counts.
4. Cloudflare Worker deploy (`cf/README.md`): `wrangler login`, `wrangler secret put ADMIN_KEY`, `npm run deploy`.
5. Audio: click "Unlock audio" on the projector once per browser session (autoplay policy).
6. Optional keys in `backend/.env` for the live persona (OpenAI) and voice (ElevenLabs); `scripts/persona_smoke.py` checks latency.

## Demo checklist
- [ ] `npm run build`, backend up in production mode, `curl localhost:8000/api/health` ok.
- [ ] Tunnel (or Worker) URL pasted into `/host` "Public URL"; projector QR codes re-rendered; a phone opens the rail URL.
- [ ] Projector: "Unlock audio" clicked; fullscreen; `/host` diagnostics show projector frame p95 < 20 ms.
- [ ] Phone scans the seat QR, calibrates (hold still, raise), swing meter moves on the projector.
- [ ] Bowling vs rookie: strike registers, odds board flips, rail phones get paid, a voice line plays (or subtitle in offline mode).
- [ ] Boxing vs contender: punches, block, parry; health bars; knockdown slow-mo.
- [ ] Baseball: swings land on arrival; studying meter rises after losses.
- [ ] Fight Night card from an idle room; rail votes; bout settles.
- [ ] Fallbacks ready: keyboard play (Enter on the projector), `--fake=1` remote, `HAP_MODE=offline` if the venue Wi-Fi drops.
- [ ] `scripts/rehearsal.sh` passed on the demo laptop today.
