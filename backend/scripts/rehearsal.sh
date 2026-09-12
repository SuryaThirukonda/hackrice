#!/usr/bin/env bash
# Unattended rehearsal: a private backend in offline mode with fast timers, one fake phone and four rail bots play
# bowling -> boxing -> Fight Night (card) end to end. Fails (exit 1) if any match does not end normally, if the ledger does
# not conserve chips, or if the server log shows a traceback. Kills everything it started.
#
#   backend/scripts/rehearsal.sh            # port 8103 by default
#   PORT=8110 backend/scripts/rehearsal.sh
set -euo pipefail
export PYTHONUNBUFFERED=1     # the fake clients log to files; we grep them while they run
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(cd "$HERE/.." && pwd)"
PORT="${PORT:-8103}"
URL="ws://localhost:$PORT"
WORK="${REHEARSAL_DIR:-$(mktemp -d /tmp/hap-rehearsal.XXXXXX)}"
DB="$WORK/rehearsal.db"
LOG="$WORK/server.log"
PIDS=()
cleanup() {
  set +e
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; fi
}
trap cleanup EXIT
fail() { echo "[rehearsal] FAIL: $*"; echo "[rehearsal] logs in $WORK"; exit 1; }

cd "$BACKEND"
if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then fail "port $PORT is already in use"; fi
echo "[rehearsal] workdir $WORK  db $DB  port $PORT"
HAP_MODE=offline HAP_FAST_TIMERS=1 HAP_DEV=1 HAP_DB="$DB" HAP_PUBLIC_URL="http://localhost:$PORT" \
  uv run uvicorn app.main:app --port "$PORT" --log-level info >"$LOG" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -sf "http://localhost:$PORT/api/health" >/dev/null || fail "backend did not come up (see $LOG)"
echo "[rehearsal] backend up: $(curl -s "http://localhost:$PORT/api/health")"

uv run python scripts/fake_remote.py --url "$URL" --seat P1 --auto --forever --sport bowling --timeout 900 --seed 1 >"$WORK/remote.log" 2>&1 &
PIDS+=($!)
uv run python scripts/fake_rail.py --url "$URL" --n 4 --every 2 --seconds 900 --vote --seed 7 >"$WORK/rail.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 60); do grep -q "calibrated" "$WORK/remote.log" 2>/dev/null && break; sleep 0.5; done
grep -q "calibrated" "$WORK/remote.log" || fail "fake remote never calibrated (see $WORK/remote.log)"
echo "[rehearsal] fake phone seated and calibrated; 4 rail bots betting"

run_match() {   # $1 label, $2.. hostctl args for the start command
  local label="$1"; shift
  echo "[rehearsal] --- $label ---"
  local start; start="$(uv run python scripts/hostctl.py --url "$URL" "$@" 2>&1)"
  echo "$start" | sed 's/^/[hostctl] /' | head -3
  echo "$start" | grep -Eq "'ok': True|match\.start: \{" || fail "$label did not start"
  local end; end="$(uv run python scripts/hostctl.py --url "$URL" wait-end --seconds 240 2>&1 | grep "match.end:" || true)"
  [ -n "$end" ] || fail "$label: no match.end within 240 s"
  echo "$end" | cut -c1-220
  local json="${end#match.end: }"
  python3 - "$json" "$label" <<'EOF' || exit 1
import json, sys
d = json.loads(sys.argv[1]); label = sys.argv[2]
assert d.get("reason") == "complete", f"{label}: match ended with reason {d.get('reason')!r}"
assert d.get("winner") in ("human", "house", "tie", "a", "b"), f"{label}: bad winner {d.get('winner')!r}"
print(f"[rehearsal] {label}: winner={d['winner']} reason={d['reason']}")
EOF
}

run_match "bowling vs rookie" start --sport bowling --tier rookie
run_match "boxing vs contender" start --sport boxing --tier contender
run_match "fight night card" send host.card '{}'

echo "[rehearsal] stopping backend to flush the store"
kill "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null || true; SERVER_PID=""
if grep -q "Traceback" "$LOG"; then echo "[rehearsal] server log has a traceback:"; grep -n -A 12 "Traceback" "$LOG" | head -40; fail "traceback in server log"; fi
if grep -Eiq "api\.openai\.com|elevenlabs\.io" "$LOG"; then fail "network call to a paid API in offline mode"; fi

python3 - "$DB" <<'EOF' || fail "chip conservation"
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
by = dict(c.execute("SELECT reason, SUM(delta) FROM ledger GROUP BY reason").fetchall())
grants = sum(v for r, v in by.items() if r in ("join_grant", "bailout", "host_adjust"))
sinks = sum(v for r, v in by.items() if r in ("sponsor_buy", "crate_bid", "crate_refund"))
bets = sum(v for r, v in by.items() if r in ("bet_place", "bet_payout", "bet_refund"))
total = sum(by.values())
burned = c.execute("SELECT COALESCE(SUM(rollover_out), 0) - COALESCE(SUM(rollover_in), 0) FROM markets").fetchone()[0]
n_matches = c.execute("SELECT COUNT(*) FROM matches WHERE ended_ts IS NOT NULL AND winner != 'void'").fetchone()[0]
n_markets = c.execute("SELECT COUNT(*) FROM markets").fetchone()[0]
n_bets = c.execute("SELECT COUNT(*) FROM bets").fetchone()[0]
neg = c.execute("SELECT device_id, SUM(delta) FROM ledger GROUP BY device_id HAVING SUM(delta) < 0").fetchall()
tables = {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("devices", "seats", "matches", "turns", "gestures", "agent_decisions", "ledger", "bets", "markets", "voice_lines")}
print(f"[rehearsal] ledger by reason: {by}")
print(f"[rehearsal] grants={grants} bets_net={bets} burned_rollover={burned} sinks={sinks} total={total} matches={n_matches} markets={n_markets} bets={n_bets}")
print(f"[rehearsal] rows: {tables}")
assert n_matches >= 3, f"expected 3 finished matches, got {n_matches}"
assert n_bets > 0, "no bets were placed"
assert bets + burned == 0, f"bets/payouts/refunds do not net to burned rollover: {bets} + {burned}"
assert total == grants + sinks - burned, f"ledger total {total} != grants {grants} + sinks {sinks} - burned {burned}"
assert not neg, f"negative balances: {neg}"
assert all(n > 0 for n in tables.values()), f"empty tables: {[t for t, n in tables.items() if n == 0]}"
print("[rehearsal] chips conserved")
EOF

echo "[rehearsal] replaying the bowling match from the store"
HAP_FAST_TIMERS=1 uv run python scripts/replay_match.py m_1 --db "$DB" | tail -3 || echo "[rehearsal] (bowling replay differs: phone-path gestures are re-timed, see replay_match.py)"
echo "[rehearsal] PASS (logs in $WORK)"
