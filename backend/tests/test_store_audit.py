"""Persistence audit: a headless match with a real Store must write every table in schema.sql, and
scripts/replay_match.py must reproduce its turn outcomes from seed + gestures + agent_decisions (+ sponsor_moves)."""
from __future__ import annotations

import json
import random
import sqlite3

import pytest

from app.arena import Intent
from app.clock import FakeClock
from app.config import FAST_TIMER_OVERRIDES, Config, _set
from app.store.db import Store
from app.wiring import build_arena
from scripts.headless_sim import PROFILES, FakeSeat, play_match
from scripts.replay_match import replay
from tests.conftest import Client

TABLES = ["devices", "seats", "matches", "turns", "gestures", "agent_decisions", "ledger", "bets", "markets", "sponsor_moves", "voice_lines", "motion_frames"]
SPONSOR_MOVE = {"bowling": "oil_shift", "baseball": "slow_pitch"}


class KeyboardSeat(FakeSeat):
    """Like FakeSeat but goes through the real input.action path so the motion worker persists each gesture."""

    def gesture(self, kind, power=0.6, extra=None, t=None):
        params = dict(extra or {})
        params["power"] = power
        self.arena.loop.submit(Intent("input.action", {"kind": kind, "params": params, "t_client": t}, self.device_id, self.conn.conn_id, "remote"))
        self.arena.step()


def fast_config() -> Config:
    cfg = Config.load()
    cfg.fast_timers, cfg.mode = True, "headless"
    for path, v in FAST_TIMER_OVERRIDES.items():
        _set(cfg.data, path, v)
    return cfg


def counts(db) -> dict[str, int]:
    conn = sqlite3.connect(str(db))
    try:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}
    finally:
        conn.close()


@pytest.fixture(params=["bowling", "baseball"])
def stored_match(request, tmp_path):
    sport = request.param
    db = tmp_path / "x.db"
    store = Store(db, batch_ms=20)
    clock = FakeClock()
    arena = build_arena(fast_config(), clock=clock, store=store)
    rails = [Client(arena, "rail", nickname=f"R{i}") for i in range(3)]
    seat = KeyboardSeat(arena)
    mm = arena.modules["market.wiring"]
    placed: set[tuple[str, str]] = set()
    rng = random.Random(11)

    def bet_all():   # bettors react to every open market from inside play_match's loop (and drain their sockets)
        for r in rails:
            r.pump()
            for m in mm.book.open_markets():
                if (r.device_id, m.market_id) not in placed:
                    placed.add((r.device_id, m.market_id))
                    r.send("market.bet", {"market_id": m.market_id, "outcome_id": rng.choice(m.outcomes).id, "stake": 25})
    arena.loop.schedule_every(0.3, bet_all, key="test.bets")
    rails[0].send("sponsor.buy", {"move_id": SPONSOR_MOVE[sport]})   # handled on the first step after match start (betting, turn 1)
    winner = play_match(arena, clock, seat, sport, "contender", PROFILES[sport], random.Random(7), seed=4242)
    match_id = arena.state.match["match_id"]
    assert rails[0].last("sponsor.ack").d["ok"] is True
    # after the match: release the seat (seats.released_ts) and record one frame with tracing on (motion_frames)
    arena.rooms.release_seat("P1"); arena.step()
    arena.state.toggles["record_traces"] = True
    arena.loop.submit(Intent("motion.frame", {"t0": 0.0, "n": 1, "s": [[0.0] * 13]}, seat.device_id, seat.conn.conn_id, "remote")); arena.step()
    store.flush(); store.close()
    return {"db": db, "match_id": match_id, "winner": winner, "sport": sport, "arena": arena, "rails": rails}


def test_every_table_is_written(stored_match):
    c = counts(stored_match["db"])
    empty = [t for t, n in c.items() if n == 0]
    assert not empty, f"tables never written: {empty} ({c})"
    conn = sqlite3.connect(str(stored_match["db"]))
    m = conn.execute("SELECT sport, seed, opponent_tier, started_ts, ended_ts, winner FROM matches WHERE match_id=?", (stored_match["match_id"],)).fetchone()
    assert m[0] == stored_match["sport"] and m[1] == 4242 and m[2] == "contender"
    assert m[3] is not None and m[4] is not None and m[4] >= m[3], "end row must merge with the start row, not replace it"
    assert m[5] == stored_match["winner"]
    g = conn.execute("SELECT match_id, turn_no, seat_id, extra_json FROM gestures").fetchall()
    assert all(r[0] == stored_match["match_id"] and r[1] >= 1 and r[2] == "P1" for r in g)
    assert all("recv_ms" in json.loads(r[3]) for r in g)
    seats = conn.execute("SELECT device_id, released_ts FROM seats ORDER BY id").fetchall()
    assert seats[0][1] is None and seats[-1][1] is not None
    turns = conn.execute("SELECT COUNT(*) FROM turns WHERE match_id=?", (stored_match["match_id"],)).fetchone()[0]
    decisions = conn.execute("SELECT COUNT(*) FROM agent_decisions WHERE match_id=?", (stored_match["match_id"],)).fetchone()[0]
    assert turns >= 1 and decisions >= turns
    grants = conn.execute("SELECT SUM(delta) FROM ledger WHERE reason IN ('join_grant','bailout','host_adjust')").fetchone()[0]
    assert grants == 4 * 500                      # three rail bettors + the seated player each get a join grant
    bets = conn.execute("SELECT SUM(delta) FROM ledger WHERE reason IN ('bet_place','bet_payout','bet_refund')").fetchone()[0]
    burned = conn.execute("SELECT SUM(rollover_out) - SUM(rollover_in) FROM markets").fetchone()[0]
    assert bets + burned == 0, "bets, payouts, refunds and burned rollover must net to zero"
    conn.close()


def test_replay_reproduces_outcomes(stored_match):
    ok, report = replay(stored_match["db"], stored_match["match_id"], fast=True, verbose=True)
    assert report, "no turns to compare"
    assert ok, report
    assert all(r["detail_ok"] for r in report), report
