"""A projector whose socket never drains must not stall the arena: high-rate events are dropped per connection,
settlement-class messages survive, and step time stays flat."""
from __future__ import annotations

import random
import statistics
import time

from app.protocol import DROPPABLE
from scripts.headless_sim import PROFILES, FakeSeat, play_match


def test_undrained_projector_drops_high_rate_events_only(arena, clock, make_client):
    proj = make_client("projector")          # never pumped from here on
    rail = make_client("rail")
    loop = arena.loop
    q = proj.conn.out
    step_ms = []
    settles = 0
    for k in range(5000):
        loop.emit("match.tick" if k % 2 else "motion.meter", {"k": k}, to="projector")
        if k % 100 == 0:
            loop.emit("market.settle", {"market_id": f"mk{k}", "k": k}, to="all")
            settles += 1
        if k % 250 == 249:
            t0 = time.perf_counter(); arena.step(); step_ms.append((time.perf_counter() - t0) * 1000)
    t0 = time.perf_counter(); arena.step(); step_ms.append((time.perf_counter() - t0) * 1000)
    assert len(q.q) <= q.maxlen
    assert q.dropped >= 5000 - q.maxlen, q.dropped
    kept = [e.t for e in q.q]
    assert kept.count("market.settle") == settles, "settles must never be evicted while droppable events are queued"
    assert kept.count("match.tick") + kept.count("motion.meter") < 5000
    assert [e.seq for e in q.q] == sorted(e.seq for e in q.q)
    assert len(rail.of("market.settle")) == settles              # other connections unaffected
    p95 = sorted(step_ms)[int(0.95 * (len(step_ms) - 1))]
    assert p95 < 50 and max(step_ms) < 250, step_ms                 # 250 emits per step, two connections
    print(f"backpressure: dropped={q.dropped} queued={len(q.q)} settles kept={settles} step p95={p95:.2f} ms max={max(step_ms):.2f} ms")


def test_full_match_with_stalled_projector(arena, clock, make_client):
    proj = make_client("projector")
    proj.conn.out.maxlen = 48                                    # a very slow projector
    seat = FakeSeat(arena)
    games = arena.modules["games.wiring"]
    mm = arena.modules["market.wiring"]
    step_ms = []
    orig_step = arena.loop.step

    def timed_step(now=None):
        t0 = time.perf_counter()
        out = orig_step(now)
        step_ms.append((time.perf_counter() - t0) * 1000)
        return out
    arena.loop.step = timed_step
    winner = play_match(arena, clock, seat, "bowling", "rookie", PROFILES["bowling"], random.Random(3), seed=7)
    assert winner in ("human", "house", "tie") and games.phase == "ended"
    assert all(m.status in ("settled", "void") for m in mm.book.markets.values())
    q = proj.conn.out
    assert q.dropped > 0 and len(q.q) <= q.maxlen
    assert not any(e.t in DROPPABLE for e in q.q) or len(q.q) < q.maxlen   # droppables only survive while there is room
    p95 = sorted(step_ms)[int(0.95 * (len(step_ms) - 1))]
    assert p95 < 20, f"step p95 {p95:.2f} ms"
    print(f"stalled projector during a match: dropped={q.dropped} queued={len(q.q)} steps={len(step_ms)} step p95={p95:.2f} ms mean={statistics.fmean(step_ms):.2f} ms")
