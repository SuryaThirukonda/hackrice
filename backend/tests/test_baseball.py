import random

from app.agents.policy import TierConfig
from app.config import Config
from app.games.baseball import BaseballMatch, Side, contact
from app.motion.detectors import Gesture


def make(tier="contender", seed=3, scenario=None):
    cfg = Config.load()
    t = TierConfig.from_dict("baseball", cfg.tier("baseball", tier))
    return BaseballMatch("m", seed, t, ["P1"], {"P1": "Sim"}, cfg, scenario)


def swing(t_server, power=0.9, angle=0.5):
    g = Gesture("swing", t_server, power=power, extra={"pitch_angle": angle})
    g.t_server = t_server
    return g


def test_contact_formulas():
    rng = random.Random(1)
    assert contact(100, 90, 0.5, 0.5, 1.0, 1, rng)["result"] == "miss"
    c = contact(0, 90, 0.5, 0.5, 1.0, 1, rng)
    assert c["quality"] == 1.0 and c["dir"] == 0.3 and c["dist"] == 1.0 and c["result"] in ("home_run", "double")
    early = contact(-60, 90, 0.5, 0.5, 0.8, 1, rng)
    assert early["dir"] > 0.3 and early["quality"] < 0.4
    assert contact(0, 90, 0.9, 0.1, 1.0, 1, rng)["quality"] < 0.6


def test_runners_and_scoring():
    s = Side("x")
    assert s.advance(1) == 0 and s.bases == [True, False, False]
    assert s.advance(2) == 0 and s.bases == [False, True, True]
    assert s.advance(4) == 3 and s.bases == [False, False, False] and s.runs == 3
    s.advance(1); s.advance(1); s.advance(1)
    assert s.advance(1) == 1 and s.runs == 4


def drive_at_bat(m, plan_swing, t0=1000.0):
    """Step the engine in 100 ms increments; plan_swing(pitch) -> dt_ms or None."""
    m.plan_turn(); m.turn_no += 1
    for req in m.decisions_before("input"):
        m.apply_decision(req, req.default)
    now = t0
    swung_for = None
    for _ in range(600):
        m.step(now=now)
        if m.pitch and swung_for != m.pitch_no:
            dt = plan_swing(m.pitch)
            if dt is not None and now * 1000 >= m.actual_arrival + dt:
                swung_for = m.pitch_no
                m.on_gesture("P1", swing(m.actual_arrival + dt))
        if m.input_done():
            break
        now += 0.1
    return m.resolve()


def test_timing_window_boundary_and_strikeouts():
    m = make("rookie")           # W = 110
    res = drive_at_bat(m, lambda p: 0)
    assert res.outcome == "hit"
    m2 = make("rookie", seed=4)
    res2 = drive_at_bat(m2, lambda p: 200)      # always way late
    assert res2.outcome == "out" and res2.detail["at_bat"]["result"] == "strikeout" and m2.human.outs == 1
    m3 = make("rookie", seed=5)
    res3 = drive_at_bat(m3, lambda p: None)     # never swings: called strikes
    assert res3.detail["at_bat"]["reason"] == "looking"


def test_determinism_and_full_game():
    def play(seed):
        m = make("contender", seed=seed)
        rng = random.Random(seed)
        results = []
        while m.plan_turn() is not None:
            m.turn_no += 1
            for req in m.decisions_before("input"):
                m.apply_decision(req, req.default)
            now = 1000.0
            swung_for = None
            for _ in range(600):
                m.step(now=now)
                if m.pitch and swung_for != m.pitch_no and now * 1000 >= m.actual_arrival - 10:
                    swung_for = m.pitch_no
                    m.on_gesture("P1", swing(m.actual_arrival + rng.gauss(-20, 60)))
                if m.input_done():
                    break
                now += 0.1
            results.append(m.resolve().outcome)
        return m.summary(), results
    a, b = play(11), play(11)
    assert a == b
    summ, results = a
    assert summ["inning"] == 3 and summ["human"]["outs"] == 0 and len(results) >= 9
    assert summ["house"]["runs"] >= 0


def test_pitcher_reads_early_swings():
    m = make("champion", seed=2)
    for _ in range(6):
        m.policy.observe(-60)
    picks = [m.policy.choose_pitch(random.Random(i)) for i in range(40)]
    assert picks.count("changeup") + picks.count("curve") > 20


def test_scenario_pitch_sequence_and_sudden_death():
    m = make("rookie", seed=1, scenario={"pitches": ["fastball", "changeup"]})
    m.plan_turn(); m.turn_no = 1
    m.step(now=1.0); m.step(now=2.6)
    assert m.pitch and m.pitch["kind"] == "fastball"
    boss = make("boss", seed=9)
    res = drive_at_bat(boss, lambda p: 300)
    assert res.detail["sudden_death_over"] and boss.plan_turn() is None and boss.winner() == "house"


def test_adaptive_converges(arena, clock):
    from scripts.headless_sim import FakeSeat, play_match, PROFILES
    seat = FakeSeat(arena)
    games = arena.modules["games.wiring"]
    prof = dict(PROFILES["bowling"], aim_sigma=0.9)    # a terrible bowler
    play_match(arena, clock, seat, "bowling", "champion", prof, random.Random(1), seed=5)
    st = arena.state.studying.get("house:bowling")
    assert st and st["n"] == 5 and st["delta"] > 0.05 and st["level"] > 0.2   # the House loosened its lane accuracy
