from scripts.headless_sim import FakeSeat, play_match, PROFILES
import random

from tests.conftest import run_for


def test_full_bowling_match_headless(arena, clock, make_client):
    proj = make_client("projector"); rails = [make_client("rail", nickname=f"R{i}") for i in range(3)]
    seat = FakeSeat(arena)
    mm = arena.modules["market.wiring"]
    games = arena.modules["games.wiring"]
    games.start_match("bowling", "rookie", None, None, seed=99)
    arena.step()
    ms = proj.last("match.start").d
    assert ms["sport"] == "bowling" and ms["opponent"]["name"] == "Gutter Gus" and ms["players"] == {"P1": "Sim"}
    assert games.phase == "betting" and len(mm.book.open_markets()) == 2       # match winner + frame 1
    for r in rails:
        for m in mm.book.open_markets():
            r.send("market.bet", {"market_id": m.market_id, "outcome_id": m.outcomes[0].id, "stake": 25})
    rng = random.Random(5)
    winner = play_match(arena, clock, seat, "bowling", "rookie", PROFILES["bowling"], rng, seed=99)
    assert winner in ("human", "house", "tie")
    end = proj.last("match.end").d
    assert end["winner"] == winner and end["score"]["human"]["total"] >= 0 and len(end["score"]["human"]["frames"]) == 5
    assert games.phase == "ended"
    assert all(m.status in ("settled", "void") for m in mm.book.markets.values())
    assert mm.ledger.total() + sum(mm.book.pending_rollover.values()) == mm.ledger.total_granted, "chips leaked"
    turns = proj.of("match.turn_result")
    assert len(turns) == 5 and all(t.d["outcome"] in ("strike", "spare", "open") for t in turns)
    ticks = proj.of("match.tick")
    assert any(t.d["who"] == "house" for t in ticks) and any(t.d["who"] == "human" for t in ticks)
    decisions = proj.of("agent.decision")
    assert len(decisions) == 5 and all(d.d["source"] == "default" for d in decisions)
    if winner == "human":
        assert arena.state.ladder["Sim"]["bowling"] == 1


def test_pause_resume_and_gap_pause(arena, clock, make_client):
    proj = make_client("projector")
    seat = FakeSeat(arena)
    games = arena.modules["games.wiring"]
    betting_s = float(arena.config.get("market.windows.betting_s"))

    def run_touch(seconds):   # the phone keeps streaming frames
        for _ in range(int(seconds / 0.1)):
            clock.advance(0.1); seat.touch(); arena.step()

    games.start_match("bowling", "rookie", None, None, seed=1)
    arena.step()
    run_touch(0.5)
    games.pause("host"); arena.step()
    assert proj.last("match.pause").d["paused"] is True and games.pause_reason == "host"
    run_touch(betting_s + 2)
    assert games.phase == "betting"                       # timers frozen while paused
    games.resume(); arena.step()
    run_touch(betting_s)
    assert games.phase == "input"
    run_for(arena, clock, 2.0)                             # no frames from the phone for > 1.5 s
    assert games.paused and games.pause_reason == "reconnect"
    run_touch(0.6)
    assert not games.paused and games.phase == "input"


def test_start_requires_a_seated_player(arena, make_client):
    host = make_client("host")
    host.send("host.start", {"sport": "bowling"}); arena.step()
    assert host.last("host.ack").d["ok"] is False and "seat" in host.last("host.ack").d["reason"]
