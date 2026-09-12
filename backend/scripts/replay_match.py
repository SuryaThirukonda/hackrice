"""Replay a stored match from matches.seed + gestures + agent_decisions (+ sponsor_moves) and diff it against turns.outcome.

  uv run python scripts/replay_match.py --list                       # recent matches in the DB
  uv run python scripts/replay_match.py m_3 [--db ../hap.db] [--fast]
  HAP_DB=/tmp/rehearsal.db HAP_FAST_TIMERS=1 uv run python scripts/replay_match.py m_1

How it works: a headless arena is rebuilt with a FakeClock that starts at matches.started_ts and advances on the same
0.1 s grid the headless runner uses. The stored agent_decisions become the decision provider (same option ids), every
stored gesture is re-injected at the moment the arena first saw it (extra_json.recv_ms, falling back to t_server), and
sponsor moves are re-applied at the start of their turn. Bowling replays are exact for any recording; baseball and boxing
are exact for headless recordings (tests, scripts/headless_sim) and best-effort for wall-clock ones, because their
outcomes depend on server-timeline timing that a FakeClock can only approximate.

Exit status: 0 when every stored turn outcome (and the winner) is reproduced, 1 otherwise, 2 on a missing match.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sqlite3
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.clock import FakeClock  # noqa: E402
from app.config import BACKEND_DIR, FAST_TIMER_OVERRIDES, Config, _set  # noqa: E402
from app.motion.detectors import Gesture  # noqa: E402
from app.wiring import build_arena  # noqa: E402
from scripts.headless_sim import FakeSeat  # noqa: E402

GESTURE_META = ("recv_ms", "source")


def default_db() -> Path:
    return Path(os.environ.get("HAP_DB") or (BACKEND_DIR / "hap.db"))


def load(db: Path, match_id: str) -> dict[str, Any] | None:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        m = conn.execute("SELECT * FROM matches WHERE match_id=?", (match_id,)).fetchone()
        if not m:
            return None
        turns = [dict(r) for r in conn.execute("SELECT * FROM turns WHERE match_id=? ORDER BY turn_no, id", (match_id,))]
        gestures = [dict(r) for r in conn.execute("SELECT * FROM gestures WHERE match_id=? ORDER BY id", (match_id,))]
        decisions = [dict(r) for r in conn.execute("SELECT * FROM agent_decisions WHERE match_id=? ORDER BY id", (match_id,))]
        sponsor = [dict(r) for r in conn.execute("SELECT * FROM sponsor_moves WHERE match_id=? ORDER BY id", (match_id,))]
        return {"match": dict(m), "turns": turns, "gestures": gestures, "decisions": decisions, "sponsor": sponsor}
    finally:
        conn.close()


def list_matches(db: Path, n: int = 20) -> list[dict[str, Any]]:
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute("SELECT match_id, sport, seed, opponent_tier, scenario, started_ts, ended_ts, winner FROM matches ORDER BY started_ts DESC LIMIT ?", (n,))]
    finally:
        conn.close()


def make_config(fast: bool) -> Config:
    cfg = Config.load()
    cfg.mode = "headless"
    if fast:
        cfg.fast_timers = True
        for path, v in FAST_TIMER_OVERRIDES.items():
            _set(cfg.data, path, v)
    return cfg


def _norm(x: Any) -> Any:
    return json.loads(json.dumps(x, sort_keys=True, default=str))


def replay(db: Path, match_id: str, fast: bool | None = None, dt: float = 0.1, max_s: float = 900.0, verbose: bool = True) -> tuple[bool, list[dict[str, Any]]]:
    rec = load(db, match_id)
    if rec is None:
        if verbose:
            print(f"no match {match_id} in {db}")
        return False, []
    mrow = rec["match"]
    sport, seed, tier_id = mrow["sport"], int(mrow["seed"]), mrow["opponent_tier"]
    if fast is None:
        fast = os.environ.get("HAP_FAST_TIMERS", "0") == "1"
    start_ts = float(mrow["started_ts"] or 1_800_000_000.0)
    cfg = make_config(fast)
    clock = FakeClock(start=start_ts)
    arena = build_arena(cfg, clock=clock, store=None)
    games = arena.modules["games.wiring"]
    sponsor = arena.modules.get("market.sponsor")

    # card matches have no human seat; both fighters' tiers come from the decision agent ids (house:boxing:<tier>:<a|b>)
    card_tiers: tuple[str, str] | None = None
    fighters = {}
    for d in rec["decisions"]:
        parts = str(d["agent_id"]).split(":")
        if len(parts) == 4 and parts[3] in ("a", "b"):
            fighters[parts[3]] = parts[2]
    if fighters.get("a") and fighters.get("b"):
        card_tiers = (fighters["a"], fighters["b"])
    seat = None if card_tiers else FakeSeat(arena, nickname="Replay")

    # decisions: (turn_no, agent_id) -> queue of stored option ids
    stored: dict[tuple[int, str], list[str]] = {}
    for d in rec["decisions"]:
        stored.setdefault((int(d["turn_no"]), str(d["agent_id"])), []).append(str(d["option_id"]))
    used = {"replayed": 0, "fallback": 0}

    def provider(req, cb):
        q = stored.get((req.turn_no, req.agent_id))
        opt = None
        if q:
            oid = q.pop(0)
            opt = next((o for o in req.options if o.id == oid), None)
        if opt is None:
            used["fallback"] += 1
            cb(req.default, "default", None, 0.0)
        else:
            used["replayed"] += 1
            cb(opt, "replay", None, 0.0)
    games.decision_provider = provider

    results: list[dict[str, Any]] = []
    games.on_turn_result.append(lambda m, res: results.append({"turn_no": m.turn_no, "outcome": res.outcome, "detail": _norm(res.detail)}))

    gestures = []
    for g in rec["gestures"]:
        extra = json.loads(g["extra_json"] or "{}")
        due = float(extra.get("recv_ms", g["t_server"] or 0.0))
        clean = {k: v for k, v in extra.items() if k not in GESTURE_META}
        gestures.append((due, g, clean))
    gestures.sort(key=lambda x: (x[0], x[1]["id"]))
    sponsor_rows = rec["sponsor"]

    games.start_match(sport, tier_id, mrow.get("scenario"), None, seed=seed, card=bool(card_tiers), tiers=card_tiers)
    arena.step()
    gi = 0
    seen_turn = 0
    t_end = clock.now() + max_s

    def inject(g: dict[str, Any], extra: dict[str, Any]) -> None:
        gg = Gesture(str(g["kind"]), t_phone=float(g["t_phone"] or 0.0), power=float(g["power"] or 0.0), axis=str(g["axis"] or "y"), sign=int(g["sign"] or 1),
                     duration_ms=float(g["duration_ms"] or 0.0), extra=extra)
        gg.t_server = float(g["t_server"] or 0.0)
        gg.device_id = seat.device_id if seat else g["device_id"]
        gg.seat_id = g["seat_id"] or "P1"
        games.on_gesture(gg)

    def apply_sponsor(turn_no: int) -> None:
        if not sponsor:
            return
        m = games.match
        for row in sponsor_rows:
            if int(row["turn_no"] or 0) == turn_no and row["move_id"] in sponsor.moves and m is not None:
                sponsor.apply(m, sponsor.moves[row["move_id"]], row["device_id"], int(row["price"] or 0))

    while games.match and not games.match.ended and clock.now() < t_end:
        clock.advance(dt)
        if seat:
            seat.touch()
        arena.step()
        m = games.match
        if m is None or m.ended:
            break
        if m.turn_no != seen_turn:
            seen_turn = m.turn_no
            apply_sponsor(seen_turn)
        now_ms = clock.now_ms()
        while gi < len(gestures) and gestures[gi][0] <= now_ms and games.match and not games.match.ended:
            inject(gestures[gi][1], gestures[gi][2])
            gi += 1
            arena.step()
    if games.match and not games.match.ended:
        games.end_match("timeout")
    replay_winner = (arena.state.match or {}).get("winner")

    # ---- diff ----
    by_turn = {r["turn_no"]: r for r in results}
    ok = True
    report: list[dict[str, Any]] = []
    for t in rec["turns"]:
        tn = int(t["turn_no"])
        r = by_turn.get(tn)
        stored_detail = _norm(json.loads(t["detail_json"] or "{}"))
        row = {"turn_no": tn, "stored": t["outcome"], "replayed": r["outcome"] if r else None,
               "outcome_ok": bool(r and r["outcome"] == t["outcome"]), "detail_ok": bool(r and r["detail"] == stored_detail)}
        ok = ok and row["outcome_ok"]
        report.append(row)
    stored_winner = mrow.get("winner")
    winner_ok = stored_winner in (None, "void") or stored_winner == replay_winner
    ok = ok and winner_ok and len(rec["turns"]) > 0
    if verbose:
        print(f"match {match_id}: {sport} vs {tier_id} seed={seed} started={start_ts} fast_timers={fast} "
              f"gestures={len(gestures)} (injected {gi}) decisions={used['replayed']} replayed/{used['fallback']} fallback sponsor_moves={len(sponsor_rows)}")
        print(f"{'turn':>4}  {'stored':<10} {'replayed':<10} outcome detail")
        for row in report:
            print(f"{row['turn_no']:>4}  {row['stored']:<10} {str(row['replayed']):<10} {'ok' if row['outcome_ok'] else 'MISMATCH':<7} {'ok' if row['detail_ok'] else 'differs'}")
        print(f"winner: stored={stored_winner} replayed={replay_winner} {'ok' if winner_ok else 'MISMATCH'}")
        print("REPLAY OK" if ok else "REPLAY MISMATCH")
    return ok, report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("match_id", nargs="?")
    ap.add_argument("--db", default=None)
    ap.add_argument("--fast", action=argparse.BooleanOptionalAction, default=None, help="use HAP_FAST_TIMERS windows (default: from env)")
    ap.add_argument("--dt", type=float, default=0.1)
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    db = Path(a.db) if a.db else default_db()
    if not db.exists():
        print(f"no database at {db}")
        return 2
    if a.list or not a.match_id:
        for m in list_matches(db):
            print(f"{m['match_id']:8s} {m['sport']:9s} {str(m['opponent_tier']):10s} seed={m['seed']} winner={m['winner']} started={m['started_ts']}")
        return 0
    ok, report = replay(db, a.match_id, fast=a.fast, dt=a.dt)
    if not report and not ok:
        return 2
    return 0 if ok else 1


if __name__ == "__main__":
    random.seed(0)
    sys.exit(main())
