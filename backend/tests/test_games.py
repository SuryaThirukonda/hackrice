import random

from app.agents.policy import TierConfig
from app.config import Config
from app.games.bowling import ALL_PINS, BowlingMatch, Frame, ball_path, first_ball, score_frames


def frames_from(rolls):
    fs = []
    for r in rolls:
        f = Frame(len(fs) + 1)
        f.rolls = list(r)
        fs.append(f)
    return fs


def test_scoring_known_sequences():
    assert score_frames(frames_from([[10]] * 9 + [[10, 10, 10]]), 10)[0] == 300
    assert score_frames(frames_from([[5, 5], [5, 0]]), 10)[0] == 20            # spare (10+5) + 5
    assert score_frames(frames_from([[10], [3, 4]]), 10)[0] == 24              # strike 17 + 7
    assert score_frames(frames_from([[9, 0]] * 5), 5)[0] == 45
    total, per = score_frames(frames_from([[10], [10]]), 10)
    assert per[0] is None and total == 0                                        # strikes wait for bonus balls
    assert score_frames(frames_from([[7, 2], [10], [10], [10, 10, 10]]), 4)[0] == 9 + 30 + 30 + 30


def test_ball_path_hooks_toward_center_for_right_hander():
    p = ball_path(lane=0.5, speed=0.6, spin=300, hand=1)
    assert p[0][1] == 0.5 and p[-1][1] < 0.5
    left = ball_path(lane=-0.5, speed=0.6, spin=300, hand=-1)
    assert left[-1][1] > -0.5


def test_gutter_and_pin_table_rates():
    rng = random.Random(1)
    n = 5000
    strikes_pocket = sum(len(first_ball(0.29, 0, 0.8, 1, rng)) == 10 for _ in range(n)) / n
    strikes_near = sum(len(first_ball(0.29 + 0.1, 0, 0.8, 1, rng)) == 10 for _ in range(n)) / n
    strikes_wide = sum(len(first_ball(0.85, 0, 0.8, 1, rng)) == 10 for _ in range(n)) / n
    assert 0.84 < strikes_pocket < 0.92 and 0.36 < strikes_near < 0.44 and strikes_wide == 0
    assert all(len(first_ball(0.85, 0, 0.8, 1, rng)) <= 4 for _ in range(200))


class G:
    def __init__(self, lane, speed, spin):
        self.kind, self.power, self.extra = "release", speed, {"lane": lane, "speed": speed, "spin_dps": spin}


def play(seed, gestures):
    cfg = Config.load()
    tier = TierConfig.from_dict("bowling", cfg.tier("bowling", "contender"))
    m = BowlingMatch("m", seed, tier, ["P1"], {"P1": "Sim"}, cfg)
    gi = iter(gestures)
    while True:
        plan = m.plan_turn()
        if plan is None:
            break
        m.turn_no += 1
        while not m.input_done():
            try:
                g = next(gi)
            except StopIteration:
                m.no_input(); break
            m.on_gesture("P1", g)
        for req in m.decisions_before("resolving"):
            m.apply_decision(req, req.default)
        m.resolve()
    return m


def test_match_is_deterministic_and_scores():
    gestures = [G(random.Random(3).gauss(0.29, 0.1), 0.7, 200) for _ in range(20)]
    a, b = play(42, gestures), play(42, gestures)
    assert a.summary() == b.summary() and a.winner() == b.winner()
    assert len(a.human) == 5 and len(a.house) == 5
    c = play(43, gestures)
    assert c.summary()["house"] != a.summary()["house"]


def test_gutter_ball_and_no_input():
    m = play(1, [G(0.99, 0.5, 0)] * 10)
    assert m.human[0].rolls == [0, 0]
    m2 = play(1, [])
    assert all(f.rolls == [0, 0] for f in m2.human[:-1]) and m2.score("human") == 0 and m2.winner() in ("house", "tie")


def test_scenario_forces_strike_in_pocket_window():
    cfg = Config.load()
    tier = TierConfig.from_dict("bowling", cfg.tier("bowling", "rookie"))
    m = BowlingMatch("m", 5, tier, ["P1"], {"P1": "Sim"}, cfg, {"strike_frames": [1], "strike_pocket_err": 0.15})
    m.plan_turn(); m.turn_no = 1
    m.on_gesture("P1", G(0.29 + 0.1, 0.7, 0))   # spin 0, x_e = lane exactly: within 0.15 of the pocket
    assert m.cur.rolls == [10]
