import random

import pytest

from app.market.bets import BetError, MarketBook
from app.market.ledger import Ledger
from tests.conftest import run_for


def book(stack=500):
    led = Ledger(None, starting_stack=stack, bailout_amount=100, bailout_below=10, bailout_cooldown_s=60)
    for d in ("a", "b", "c", "d"):
        led.grant_on_join(d, 0)
    return led, MarketBook(led, min_bet=10, max_stake=200)


def test_parimutuel_pro_rata_and_remainder():
    led, bk = book()
    m = bk.open_market("m1", "turn_outcome", "Frame 1", [("strike", "Strike"), ("open", "Open")], closes_ts=100)
    bk.place(m.market_id, "a", "strike", 100, 1); bk.place(m.market_id, "b", "strike", 50, 1); bk.place(m.market_id, "c", "open", 100, 1)
    bk.settle(m.market_id, "strike", 2)
    assert m.payouts == {"a": 166, "b": 83} and m.rollover_out == 1
    assert led.balance("a") == 566 and led.balance("b") == 533 and led.balance("c") == 400


def test_no_winning_backers_rolls_over_into_next_market_of_same_match():
    led, bk = book()
    m1 = bk.open_market("m1", "turn_outcome", "F1", [("x", "X"), ("y", "Y")], 100)
    bk.place(m1.market_id, "a", "x", 40, 1)
    bk.settle(m1.market_id, "y", 2)
    assert m1.payouts == {} and m1.rollover_out == 40 and bk.pending_rollover["m1"] == 40
    other = bk.open_market("m2", "turn_outcome", "F1", [("x", "X")], 100)
    assert other.rollover_in == 0
    m2 = bk.open_market("m1", "turn_outcome", "F2", [("x", "X"), ("y", "Y")], 100)
    assert m2.rollover_in == 40
    bk.place(m2.market_id, "b", "x", 10, 1)
    bk.settle(m2.market_id, "x", 2)
    assert m2.payouts == {"b": 50} and led.balance("b") == 540


def test_tie_splits_evenly_then_pro_rata():
    led, bk = book()
    m = bk.open_market("m1", "round_winner", "R1", [("h", "Human"), ("x", "House"), ("draw", "Draw")], 100)
    bk.place(m.market_id, "a", "h", 100, 1); bk.place(m.market_id, "b", "x", 20, 1); bk.place(m.market_id, "c", "x", 80, 1); bk.place(m.market_id, "d", "draw", 100, 1)
    bk.settle(m.market_id, ["h", "x"], 2)
    assert m.payouts == {"a": 150, "b": 30, "c": 120} and m.rollover_out == 0


def test_void_refunds_face_value_and_passes_rollover():
    led, bk = book()
    bk.pending_rollover["m1"] = 30
    m = bk.open_market("m1", "turn_outcome", "F1", [("x", "X"), ("y", "Y")], 100)
    bk.place(m.market_id, "a", "x", 60, 1)
    bk.void(m.market_id, 2)
    assert led.balance("a") == 500 and m.rollover_out == 30 and bk.pending_rollover["m1"] == 30


def test_rejections():
    led, bk = book(stack=15)
    m = bk.open_market("m1", "turn_outcome", "F1", [("x", "X")], closes_ts=100)
    with pytest.raises(BetError, match="minimum"):
        bk.place(m.market_id, "a", "x", 5, 1)
    with pytest.raises(BetError, match="not enough"):
        bk.place(m.market_id, "a", "x", 20, 1)
    with pytest.raises(BetError, match="no such outcome"):
        bk.place(m.market_id, "a", "zzz", 10, 1)
    with pytest.raises(BetError, match="closed"):
        bk.place(m.market_id, "a", "x", 10, 101)
    with pytest.raises(BetError, match="maximum"):
        bk.place(m.market_id, "a", "x", 500, 1)


def test_bailout_rule():
    led = Ledger(None, starting_stack=20, bailout_amount=100, bailout_below=10, bailout_cooldown_s=60)
    led.grant_on_join("a", 0)
    assert led.maybe_bailout("a", 1) == 0                      # 20 >= 10
    led.append("a", -15, "bet_place", "m", 1)
    assert led.maybe_bailout("a", 2) == 100 and led.balance("a") == 105
    led.append("a", -100, "bet_place", "m", 3)
    assert led.maybe_bailout("a", 30) == 0                     # cooldown
    assert led.maybe_bailout("a", 63) == 100


def test_conservation_random_chains():
    rng = random.Random(7)
    led, bk = book(stack=10_000)
    devs = ["a", "b", "c", "d"]
    granted = led.total_granted
    for i in range(1000):
        match_id = f"m{rng.randrange(5)}"
        n_out = rng.randrange(2, 4)
        m = bk.open_market(match_id, "t", "T", [(f"o{k}", f"O{k}") for k in range(n_out)], 100)
        for _ in range(rng.randrange(0, 6)):
            d = rng.choice(devs)
            try:
                bk.place(m.market_id, d, f"o{rng.randrange(n_out)}", rng.choice([10, 25, 50, 200]), 1)
            except BetError:
                pass
        r = rng.random()
        if r < 0.1:
            bk.void(m.market_id, 2)
        elif r < 0.2:
            bk.settle(m.market_id, [f"o{k}" for k in range(n_out)][: rng.randrange(1, n_out + 1)], 2)
        else:
            bk.settle(m.market_id, f"o{rng.randrange(n_out)}", 2)
    pending = sum(bk.pending_rollover.values())
    assert led.total() + pending == granted, "chips leaked or were created"


def test_arena_market_flow(arena, make_client, clock):
    rail1 = make_client("rail", nickname="One"); rail2 = make_client("rail", nickname="Two"); proj = make_client("projector")
    assert rail1.last("market.balance").d["balance"] == 500
    mm = arena.modules["market.wiring"]
    m = mm.open_market("mx", "turn_outcome", "Frame 1", [("strike", "Strike"), ("open", "Open")], window_s=5, turn_no=1)
    arena.step()
    assert proj.last("market.window").d["market_id"] == m.market_id
    rail1.send("market.bet", {"market_id": m.market_id, "outcome_id": "strike", "stake": 25}, cseq=7)
    rail2.send("market.bet", {"market_id": m.market_id, "outcome_id": "open", "stake": 50})
    rail2.send("market.bet", {"market_id": m.market_id, "outcome_id": "open", "stake": 5})
    arena.step()
    assert rail1.last("market.bet_ack").d["ok"] and rail1.last("market.bet_ack").d["balance"] == 475 and rail1.last("market.bet_ack").d["cseq"] == 7
    assert rail2.last("market.bet_ack").d["ok"] is False and "minimum" in rail2.last("market.bet_ack").d["reason"]
    run_for(arena, clock, 0.6)
    assert proj.last("market.odds").d["pools"] == {"strike": 25, "open": 50}
    run_for(arena, clock, 5.0)
    assert proj.last("market.window").d["open"] is False      # window closed by timer
    rail1.send("market.bet", {"market_id": m.market_id, "outcome_id": "strike", "stake": 25}); arena.step()
    assert rail1.last("market.bet_ack").d["ok"] is False
    mm.settle(m.market_id, "strike"); arena.step()
    s = proj.last("market.settle").d
    assert s["winner"] == ["strike"] and s["payouts"][0]["amount"] == 75 and s["upset"] is True
    assert rail1.last("market.balance").d["balance"] == 550 and rail2.last("market.balance").d["balance"] == 450
    rows = proj.last("market.leaderboard").d["rows"]
    assert rows[0]["nickname"] == "One" and rows[0]["chips"] == 550 and "Called it" in rows[0]["titles"]
    assert arena.modules["market.wiring"].ledger.total() == 1000
