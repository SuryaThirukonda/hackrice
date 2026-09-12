import random

from app.agents.bosses import RhythmLearner
from app.agents.policy import TierConfig
from app.config import Config
from app.games.boxing import BoxingMatch
from app.games.bowling import BowlingMatch
from app.motion.detectors import Gesture
from scripts.headless_sim import FakeSeat, play_match, PROFILES
from tests.conftest import run_for


def test_rhythm_learner_predicts_and_resets():
    rl = RhythmLearner()
    t = 0.0
    for _ in range(6):
        t += 0.9
        rl.on_punch(t, "jab")
    assert rl.predicted is not None and abs(rl.predicted - (t + 0.9)) < 1e-6 and rl.level > 0.9
    assert rl.guard_now(t + 0.85) == "block" and rl.guard_now(t + 0.86) is None    # one guard per predicted beat
    rl.on_punch(t + 2.5, "hook")                                                    # rhythm broken (> 40% off)
    assert rl.predicted is None and len(rl.times) == 1


def test_boss_boxer_blocks_on_the_beat():
    cfg = Config.load()
    t = TierConfig.from_dict("boxing", cfg.tier("boxing", "boss"))
    m = BoxingMatch("m", 1, t, ["P1"], {"P1": "Sim"}, cfg)
    from app.agents.bosses import attach_boss
    attach_boss(m)
    m.plan_turn(); m.turn_no = 1
    m.b.house.base["reaction_ms"] = 9999        # only the learner can save the boss
    m.b.house.base["aggression"] = 0.0
    m.b.house.base["retreat_p"] = 0.0           # stay in range; the learner is what we measure
    m.b.house.base["punish_p"] = 0.0
    m.b.hp = 10_000.0                           # no knockdowns in this drill
    blocked_before = m.b.blocked
    tick = 0
    for i in range(400):
        if i % 18 == 0 and i > 0:                # metronome: a jab every 0.9 s
            g = Gesture("punch", 0, power=0.8, duration_ms=70, extra={"type": "jab"}); g.seat_id = "P1"
            m.on_gesture("P1", g)
        m.step(); tick += 1
    assert m.rhythm.hits_predicted >= 5 and m.b.blocked - blocked_before >= 5
    assert any(e.get("kind") == "rhythm" for e in m.events) or m.rhythm.level > 0.9


def test_pin_king_reracks_ball_two_and_closer_seeds_pool():
    cfg = Config.load()
    t = TierConfig.from_dict("bowling", cfg.tier("bowling", "boss"))
    m = BowlingMatch("m", 3, t, ["P1"], {"P1": "Sim"}, cfg)
    class G:
        def __init__(self): self.kind, self.power, self.extra = "release", 0.5, {"lane": 0.9, "speed": 0.5, "spin_dps": 0}
    for _ in range(2):
        m.plan_turn(); m.turn_no += 1
        m.on_gesture("P1", G()); m.on_gesture("P1", G())
        for r in m.decisions_before("resolving"):
            m.apply_decision(r, r.default)
        m.resolve()
    m.plan_turn(); m.turn_no += 1
    m.on_gesture("P1", G())
    p = m.next_prompt()
    assert p["twist"] and m.cur.standing == {7, 10} and any(t.get("rerack") for t in m.cur_ticks)
    from app.games.baseball import BaseballMatch
    bt = TierConfig.from_dict("baseball", cfg.tier("baseball", "boss"))
    b = BaseballMatch("m", 3, bt, ["P1"], {"P1": "Sim"}, cfg)
    assert b.match_winner_market().seed_stake == {"house": 300}


def test_sponsor_price_caps_cooldown_and_warning(arena, clock, make_client):
    proj = make_client("projector"); rail = make_client("rail", nickname="Fan")
    seat = FakeSeat(arena)
    games, sp, mm = arena.modules["games.wiring"], arena.modules["market.sponsor"], arena.modules["market.wiring"]
    games.start_match("bowling", "rookie", None, None, seed=1); arena.step()
    assert arena.state.moves and rail.last("session.snapshot") is not None
    price0 = sp.price(sp.moves["oil_shift"])
    mm.book.place(games.match_market_id, rail.device_id, "house", 200, clock.now())      # the House is now the favorite
    assert sp.price(sp.moves["oil_shift"]) > price0
    mm.book.place(games.match_market_id, seat.device_id, "human", 200, clock.now())
    rail.send("sponsor.buy", {"move_id": "oil_shift"}); arena.step()
    ack = rail.last("sponsor.ack").d
    assert ack["ok"] and proj.last("sponsor.warn").d["move_id"] == "oil_shift"
    assert proj.last("sponsor.applied") is None
    run_for(arena, clock, 2.2)
    assert proj.last("sponsor.applied").d["buyer"] == "Fan" and games.match.lane_drift != 0 and games.match.sponsored_turn
    rail.send("sponsor.buy", {"move_id": "oil_shift"}); arena.step()
    assert "cooldown" in rail.last("sponsor.ack").d["reason"]
    run_for(arena, clock, 21)
    rail.send("sponsor.buy", {"move_id": "oil_shift"}); arena.step()
    assert rail.last("sponsor.ack").d["ok"]
    run_for(arena, clock, 23)
    rail.send("sponsor.buy", {"move_id": "oil_shift"}); arena.step()
    assert "cap" in rail.last("sponsor.ack").d["reason"]
    rail.send("sponsor.buy", {"move_id": "second_wind"}); arena.step()
    assert "boxing" in rail.last("sponsor.ack").d["reason"]
    in_play = sum(m.total_stakes() for m in mm.book.markets.values() if m.status in ("open", "closed"))   # the match_winner market is still unsettled
    assert mm.ledger.total() + in_play + sum(mm.book.pending_rollover.values()) + sum(-e.delta for e in mm.ledger.entries if e.reason == "sponsor_buy") == mm.ledger.total_granted


def test_crate_auction_after_four_turns(arena, clock, make_client):
    proj = make_client("projector"); a = make_client("rail", nickname="A"); b = make_client("rail", nickname="B")
    seat = FakeSeat(arena)
    sp = arena.modules["market.sponsor"]
    sp.rng = random.Random(1)
    games = arena.modules["games.wiring"]
    games.start_match("bowling", "rookie", None, None, seed=2); arena.step()
    # drive four turns quickly with the sim helper's gesture path
    class Bot:
        pass
    prof = PROFILES["bowling"]
    rng = random.Random(3)
    turns = 0
    while games.match and not games.match.ended and turns < 4:
        if games.phase == "input":
            seat.gesture("release", 0.6, {"lane": 0.29, "speed": 0.6, "spin_dps": 0}); arena.step()
            seat.gesture("release", 0.6, {"lane": 0.0, "speed": 0.6, "spin_dps": 0}); arena.step()
            turns += 1
        clock.advance(0.2); seat.touch(); arena.step()
        if proj.last("crate.open"):
            break
    for _ in range(300):
        if proj.last("crate.open"):
            break
        clock.advance(0.2); seat.touch(); arena.step()
        if games.phase == "input":
            seat.gesture("release", 0.6, {"lane": 0.29, "speed": 0.6, "spin_dps": 0}); seat.gesture("release", 0.6, {"lane": 0.0, "speed": 0.6, "spin_dps": 0}); arena.step()
    assert proj.last("crate.open") is not None
    a.send("crate.bid", {"amount": 60}); b.send("crate.bid", {"amount": 90}); arena.step()
    assert arena.state.crate["n_bids"] == 2
    for _ in range(int(float(arena.config.get("market.sponsor.crate_bid_s")) / 0.2) + 3):
        clock.advance(0.2); seat.touch(); arena.step()
    res = proj.last("crate.result").d
    assert res["winner"] == "B" and res["amount"] == 90 and arena.modules["market.wiring"].ledger.balance(b.device_id) == 500 - 90
    assert proj.last("sponsor.warn") is not None


def test_card_vote_starts_agent_match(arena, clock, make_client):
    proj = make_client("projector"); rails = [make_client("rail", nickname=f"R{i}") for i in range(3)]
    card = arena.modules["market.card"]
    card.rng = random.Random(5)
    card.open_vote(); arena.step()
    vo = proj.last("card.vote_open").d
    assert len(vo["pairings"]) == 2
    for r in rails:
        r.send("card.vote", {"pairing_id": vo["pairings"][1]["id"]})
    arena.step()
    assert arena.state.card["tally"][vo["pairings"][1]["id"]] == 3
    run_for(arena, clock, float(arena.config.get("market.card.vote_s")) + 0.5)
    res = proj.last("card.vote_result").d
    assert res["winner"]["id"] == vo["pairings"][1]["id"]
    ms = proj.last("match.start").d
    assert ms["card"] and ms["human_seats"] == [] and ms["sport"] == "boxing"
    games = arena.modules["games.wiring"]
    for _ in range(3000):
        clock.advance(0.1); arena.step()
        if games.match.ended:
            break
    assert games.match.ended and proj.last("match.end").d["winner"] in ("a", "b", "tie")
    mm = arena.modules["market.wiring"]
    assert all(m.status in ("settled", "void") for m in mm.book.markets.values())


def test_idle_room_opens_a_vote(arena, clock, make_client):
    proj = make_client("projector"); rail = make_client("rail", nickname="Lonely")
    run_for(arena, clock, float(arena.config.get("market.card.idle_start_s")) + 5, dt=0.5)
    assert proj.last("card.vote_open") is not None


def test_bump_pairing_transfer_and_rebump(arena, clock, make_client):
    a = make_client("rail", nickname="A"); b = make_client("rail", nickname="B"); c = make_client("rail", nickname="C")
    pairing = arena.modules["market.pairing"]
    mm = arena.modules["market.wiring"]
    a.send("pair.request", {"kind": "transfer", "amount": 120}); arena.step()
    assert a.last("pair.prompt").d["kind"] == "transfer"
    def bump(dev, t_ms):
        g = Gesture("bump", t_ms, power=0.8); g.device_id, g.t_server = dev, t_ms
        pairing.on_gesture(g)
    t0 = clock.now_ms()
    bump(a.device_id, t0); bump(b.device_id, t0 + 60); bump(c.device_id, t0 + 90); arena.step()
    assert "again" in a.last("pair.prompt").d["text"]
    clock.advance(2.0); arena.step()
    t1 = clock.now_ms()
    bump(a.device_id, t1); bump(b.device_id, t1 + 100); arena.step()
    run_for(arena, clock, 0.4, dt=0.1)
    res = a.last("pair.result").d
    assert res["ok"] and res["amount"] == 120 and mm.ledger.balance(a.device_id) == 380 and mm.ledger.balance(b.device_id) == 620


def test_two_glove_guard_needs_both_hands():
    cfg = Config.load()
    t = TierConfig.from_dict("boxing", cfg.tier("boxing", "rookie"))
    m = BoxingMatch("m", 1, t, ["L", "R"], {"L": "Lefty", "R": "Righty"}, cfg)
    m.plan_turn(); m.turn_no = 1
    gl = Gesture("block_on", 0); gl.seat_id = "L"
    m.on_gesture("L", gl); m.step()
    assert m.a.guard is False
    gr = Gesture("block_on", 0); gr.seat_id = "R"
    m.on_gesture("R", gr); m.step()
    assert m.a.guard is True
