# The House Always Plays

Phone-as-motion-remote sports (bowling, baseball, boxing) on a projector, against AI House opponents, with a play-chip betting rail for every other phone. Spec: `docs/house-always-plays-implementation-plan.md` (product) and `docs/TECH_PLAN.md` (technical).

## Run (three terminals)

```bash
cd backend && uv run --env-file .env uvicorn app.main:app --port 8000 --reload
```
```bash
cd web && npm run dev -- --host
```
```bash
# human step: gives phones an HTTPS origin (required for motion sensors). Paste the printed URL into the host page.
cloudflared tunnel --url http://localhost:5173
```

Pages: `http://localhost:5173/projector`, `/host`, `/rail`, `/remote?seat=P1&tok=...` (scan a seat QR on the projector, or open `/host` for the join URLs). Add `&fake=1` to the remote URL on a laptop for synthetic motion.

## Modes

Env in `backend/.env` (see `.env.example`): `HAP_MODE=normal|offline|scripted|headless`, `HAP_FAST_TIMERS=1` for short windows in unattended runs, `HAP_DEV=1` enables the desktop-test remote. No API keys means the offline persona (taunt bank) and cache-only voice.

## Verify

```bash
cd backend && uv run pytest -q
```
```bash
cd web && npm run build
```

## Human-only steps (need real phones)

Install `cloudflared` (`curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/c.deb && sudo dpkg -i /tmp/c.deb`), `mkcert` for the offline fallback, iOS permission tap in Safari, and detector threshold tuning with `backend/scripts/record_trace.py` against real swings.
