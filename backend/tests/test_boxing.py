from app.agents.policy import TierConfig
from app.config import Config
from app.games.boxing import BoxingMatch
from app.motion.detectors import Gesture


def make(tier="rookie", seed=1, card=None, cfg=None):
    cfg = cfg or Config.load()
    t = TierConfig.from_dict("boxing", cfg.tier("boxing", tier))
    return BoxingMatch("m", seed, t, [] if card else ["P1"], {} if card else {"P1": "Sim"}, cfg, None, card=card)


def punch(kind="jab", power=0.8, dur=80):
    return Gesture("punch", 0, power=power, duration_ms=dur, extra={"type": kind})


def run_round(m, inputs=None, ticks=None):
    """inputs: dict tick_index -> gesture. Steps one full round."""
    plan = m.plan_turn()
    if plan is None:
        return None, []
    m.turn_no += 1
    for req in m.decisions_before("input"):
        m.apply_decision(req, req.default)
    n = ticks or int(m.round_s / (m.tick_ms / 1000))
    summaries = []
    for i in range(n):
        if inputs and i in inputs:
            m.on_gesture("P1", inputs[i])
        summaries.append(m.step())
        if m.input_done():
            break
    return plan, summaries


def test_damage_block_dodge_and_stamina():
    m = make("rookie")
    m.plan_turn(); m.turn_no = 1
    m.b.house.base["reaction_ms"] = 9999      # the House never reacts in this test
    m.on_gesture("P1", punch("jab", 1.0)); m.step()
    assert m.b.hp == 100 - 18 and abs(m.a.stamina - 90) < 0.5 and m.a.landed == 1
    m.on_gesture("P1", punch("hook", 0.5)); m.step()
    assert abs(m.b.hp - (82 - 13 * 1.4)) < 1e-6 and abs(m.a.stamina - (90 + 4 * 0.05 - 16 + 4 * 0.05)) < 0.5
    m.b.state, m.b.guard = "block", True
    hp = m.b.hp
    m.on_gesture("P1", punch("jab", 1.0)); m.step()
    assert abs((hp - m.b.hp) - 18 * 0.2) < 1e-6 and m.b.blocked == 1
    m.b.state, m.b.guard, m.b.dodge_until = "dodge", False, m.t + 1
    hp = m.b.hp
    m.on_gesture("P1", punch("jab", 1.0)); m.step()
    assert m.b.hp == hp and m.b.dodged == 1
    m.a.stamina = 5
    m.on_gesture("P1", punch("jab", 1.0)); s = m.step()
    assert any(e["kind"] == "gassed" for e in s["events"])


def test_knockdown_and_ko_end_the_match():
    m = make("rookie")
    m.plan_turn(); m.turn_no = 1
    m.b.house.base["reaction_ms"] = 9999
    m.b.hp = 51
    m.on_gesture("P1", punch("jab", 1.0)); s = m.step()
    assert m.b.state == "down" and s["flags"].get("slowmo") and m.b.knockdowns == 1 and not m.round_over
    for _ in range(int(m.down_s / 0.05) + 2):
        m.step()
    assert m.b.state == "idle"
    m.b.hp = 5
    m.on_gesture("P1", punch("hook", 1.0)); s = m.step()
    assert m.ko == "human" and m.round_over and m.input_done()
    res = m.resolve()
    assert res.outcome == "human" and m.winner() == "human" and m.plan_turn() is None


def test_parry_stuns_and_whiff_opens():
    m = make("rookie")
    m.plan_turn(); m.turn_no = 1
    m.b.state, m.b.state_until, m.b.pending_kind = "telegraph", m.t + 0.5, "hook"
    m.on_gesture("P1", Gesture("parry", 0)); s = m.step()
    assert m.b.state == "stunned" and any(e["kind"] == "parry" and e["result"] == "success" for e in s["events"])
    m.b.house.base["reaction_ms"] = 9999
    hp = m.b.hp
    m.on_gesture("P1", punch("jab", 1.0)); m.step()
    assert abs((hp - m.b.hp) - 18 * 1.5 * 1.25) < 1e-6        # parry bonus × stunned
    m.b.state = "idle"
    m.on_gesture("P1", Gesture("parry", 0)); s = m.step()
    assert any(e["result"] == "whiff" for e in s["events"]) and m.a.open_until > m.t


def test_three_rounds_and_determinism():
    cfg = Config.load()
    a = make("contender", seed=7, cfg=cfg); b = make("contender", seed=7, cfg=cfg)
    for mm in (a, b):
        for _ in range(3):
            plan, _s = run_round(mm, inputs={20: punch("jab"), 60: punch("hook"), 120: Gesture("block_on", 0), 200: Gesture("block_off", 0)})
            if plan is not None:
                mm.resolve()
    assert a.summary() == b.summary()
    assert a.plan_turn() is None and len(a.round_winners) == a.round_no and (a.ko or a.round_no == 3)
    n_ticks = int(30 / 0.05)
    c = make("rookie", seed=3, cfg=cfg)
    _, summ = run_round(c)
    assert len(summ) == n_ticks and summ[-1]["round_over"] and c.b.thrown > 0


def test_agent_vs_agent_card_completes_without_input():
    m = make(seed=11, card=("champion", "boss"))
    assert m.a.name == "The Brawler" and m.b.name == "The House Champ" and m.tick_ms == 80
    while m.plan_turn() is not None:
        m.turn_no += 1
        for req in m.decisions_before("input"):
            m.apply_decision(req, req.default)
        while not m.input_done():
            m.step()
        m.resolve()
    assert m.winner() in ("a", "b", "tie") and (m.a.thrown + m.b.thrown) > 10
    spec = m.match_winner_market()
    assert [o[0] for o in spec.outcomes] == ["a", "b"]


def test_tier_reaction_gates_blocking():
    cfg = Config.load()
    rook, boss = make("rookie", cfg=cfg), make("boss", cfg=cfg)
    for mm in (rook, boss):
        mm.plan_turn(); mm.turn_no = 1
        for i in range(200):
            mm.a.stamina = 100.0
            mm.on_gesture("P1", punch("jab", 0.8, dur=80)); mm.step()
            mm.b.state, mm.b.guard, mm.b.hp = "idle", False, 100.0
    assert rook.b.blocked + rook.b.dodged == 0 and boss.b.blocked + boss.b.dodged > 40
