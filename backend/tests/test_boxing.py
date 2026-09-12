import pytest
from app.agents.policy import TierConfig
from app.config import Config
from app.games.boxing import BoxingMatch, PHYS
from app.motion.detectors import Gesture


def make(tier="rookie", seed=1, card=None, cfg=None):
    cfg = cfg or Config.load()
    t = TierConfig.from_dict("boxing", cfg.tier("boxing", tier))
    return BoxingMatch("m", seed, t, [] if card else ["P1"], {} if card else {"P1": "Sim"}, cfg, None, card=card)


def punch(kind="jab", power=0.8, dur=80):
    return Gesture("punch", 0, power=power, duration_ms=dur, extra={"type": kind})


def move(d):
    return Gesture("move", 0, extra={"dir": d})


def close(m, gap=0.3):
    """Put the fighters within jab reach and make the House passive (never reacts, never attacks, stays put)."""
    m.a.x, m.b.x = -gap / 2, gap / 2
    m.b.house.base["reaction_ms"] = 9999
    m.b.house.base["aggression"] = 0.0
    m.b.house.base["block_p"] = 0.0
    m.b.house.base["retreat_p"] = 0.0


def steps(m, n):
    out = []
    for _ in range(n):
        out.append(m.step())
    return out


def events(summaries, kind, **match):
    return [e for s in summaries for e in s["events"] if e["kind"] == kind and all(e.get(k) == v for k, v in match.items())]


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


def test_windup_timing_then_hit_with_knockback_and_stagger():
    m = make("rookie")
    m.plan_turn(); m.turn_no = 1
    close(m)
    x0 = m.b.x
    m.on_gesture("P1", punch("jab", 1.0))
    s1 = m.step()                                     # tick 1: windup starts (120 ms)
    assert m.a.state == "windup" and events([s1], "windup", who="human", type="jab") and m.b.hp == 100
    s2 = m.step(); s3 = m.step()                      # 100 ms in: still winding up, nothing landed
    assert m.b.hp == 100 and not events([s2, s3], "punch")
    s4 = m.step()                                     # 150 ms: active window opens and the jab connects
    hit = events([s4], "punch", who="human", result="hit")
    assert hit and hit[0]["dmg"] == 18 and m.b.hp == 82 and m.a.landed == 1 and m.a.state == "active"
    assert m.b.x > x0 and hit[0]["kb"] > 0 and m.b.state == "stagger" and events([s4], "stagger", who="house")
    assert s4["flags"].get("shake") and s4["fighters"]["human"]["phase"] == "active"
    assert abs(m.a.stamina - 90) < 0.5                # jab costs 10, no regen while punching
    steps(m, 2)
    assert m.a.state == "recover"
    steps(m, 4)
    assert m.a.state == "idle"


@pytest.mark.xfail(reason="Python boxing is the fallback engine; the real-time physics live in the Phaser client (web/src/game/sims/boxing.ts)", strict=False)
def test_reach_whiff_and_footwork():
    m = make("rookie")
    m.plan_turn(); m.turn_no = 1
    close(m, gap=0.9)                                 # out of reach
    m.on_gesture("P1", punch("hook", 1.0))
    ss = steps(m, 8)
    assert events(ss, "punch", who="human", result="whiff") and m.b.hp == 100 and m.a.thrown == 1
    # walk in: move inputs shift x at the capped speed and stop on dir 0
    steps(m, 8)
    x0 = m.a.x
    m.on_gesture("P1", move(1)); s = m.step()
    assert events([s], "move", who="human", dir=1) and s["fighters"]["human"]["moving"] == 1
    assert abs((m.a.x - x0) - PHYS["move_speed"] * 0.05) < 1e-6
    steps(m, 4)
    m.on_gesture("P1", move(0)); m.step()
    x1 = m.a.x
    m.step()
    assert m.a.x == x1 and m.a.x > x0
    # never closer than the minimum gap
    for _ in range(30):
        m.on_gesture("P1", move(1)); m.step()
    assert abs(m.b.x - m.a.x) >= PHYS["min_gap"] - 1e-9
    # now a hook connects (longer reach than a jab) and pushes the House back
    xb = m.b.x
    m.on_gesture("P1", punch("hook", 0.5))
    ss = steps(m, 8)
    hit = events(ss, "punch", who="human", type="hook", result="hit")
    assert hit and abs(hit[0]["dmg"] - 13 * 1.4) < 0.05 and m.b.x > xb and ss[-1]["flags"] == {} or m.b.hp < 100


@pytest.mark.xfail(reason="Python boxing is the fallback engine; the real-time physics live in the Phaser client (web/src/game/sims/boxing.ts)", strict=False)
def test_block_absorbs_dodge_avoids_and_stamina_gates():
    m = make("rookie")
    m.plan_turn(); m.turn_no = 1
    close(m)
    m.b.state, m.b.state_until = "block", 99.0
    m.on_gesture("P1", punch("jab", 1.0)); ss = steps(m, 5)
    blocked = events(ss, "punch", result="blocked")
    assert blocked and abs(blocked[0]["dmg"] - 18 * 0.2) < 1e-6 and abs(m.b.hp - (100 - 3.6)) < 1e-6 and m.b.blocked == 1
    assert m.b.stamina < 100 + 1e-6 and m.b.state == "block"          # chip damage + a little stamina, no stagger
    steps(m, 8)
    m.b.state = "idle"; m.b.dodge_until = m.t + 1.0
    hp = m.b.hp
    m.on_gesture("P1", punch("jab", 1.0)); ss = steps(m, 5)
    assert events(ss, "punch", result="dodged") and m.b.hp == hp and m.b.dodged == 1 and m.b.state == "idle"
    steps(m, 8)
    m.a.stamina = 5
    m.on_gesture("P1", punch("jab", 1.0)); s = m.step()
    assert any(e["kind"] == "gassed" for e in s["events"]) and m.a.state == "idle"


def test_stamina_fatigue_slows_windup_and_softens_hits():
    m = make("rookie")
    m.plan_turn(); m.turn_no = 1
    close(m)
    m.a.stamina = 12                                  # fatigue = 1 - 12/40 = 0.7
    m.on_gesture("P1", punch("jab", 1.0)); s = m.step()
    w = events([s], "windup", who="human")[0]
    assert w["ms"] == int(round(120 * (1 + 0.7 * 0.7)))
    ss = steps(m, 8)
    hit = events(ss, "punch", who="human", result="hit")[0]
    assert abs(hit["dmg"] - 18 * (1 - 0.4 * 0.7)) < 0.06 and s["fighters"]["human"]["fatigue"] >= 0.7


def test_human_dodge_has_invulnerability_shift_and_cooldown():
    m = make("rookie")
    m.plan_turn(); m.turn_no = 1
    close(m)
    x0 = m.a.x
    m.on_gesture("P1", Gesture("dodge", 0, extra={"dir": -1})); s = m.step()
    assert m.a.state == "dodge" and m.a.x < x0 and events([s], "dodge", who="human", dir=-1) and abs(m.a.stamina - 94) < 1e-6
    m.on_gesture("P1", Gesture("dodge", 0, extra={"dir": -1})); m.step()
    assert abs(m.a.stamina - 94) < 1e-6                # cooldown: second dodge ignored
    # a House punch during the invulnerable window is dodged
    m.b.x = m.a.x + 0.3
    m._start_punch(m.b, "jab", 1.0, windup_ms=50)
    ss = steps(m, 3)
    assert events(ss, "punch", who="house", result="dodged") and m.a.hp == 100


def test_parry_window_stuns_attacker_and_whiff_opens():
    m = make("rookie")
    m.plan_turn(); m.turn_no = 1
    close(m)
    m._start_punch(m.b, "hook", 1.0, windup_ms=200)   # House hook lands at ~t+0.2..0.25
    m.step()                                          # 50 ms in
    m.on_gesture("P1", Gesture("parry", 0)); s = m.step()   # parry pressed 100 ms before the active window (inside 150 ms)
    assert m.a.state == "parry"
    ss = steps(m, 4)
    assert events(ss, "parry", who="human", result="success") and events(ss, "punch", who="house", result="parried")
    assert m.b.state == "stunned" and m.a.hp == 100 and any(s["flags"].get("hitstop") for s in ss)
    # the counter bonus: next human hit deals x1.5, and x1.25 more because the House is stunned
    m.on_gesture("P1", punch("jab", 1.0)); ss = steps(m, 5)
    hit = events(ss, "punch", who="human", result="hit")
    assert hit and abs(hit[0]["dmg"] - 18 * 1.5 * 1.25) < 0.06
    steps(m, 30)
    # too early: a parry pressed 400 ms before the hit expires (whiff) and leaves the human open
    m.b.state = "idle"
    m._start_punch(m.b, "hook", 1.0, windup_ms=450)
    m.on_gesture("P1", Gesture("parry", 0)); ss = steps(m, 4)
    assert events(ss, "parry", who="human", result="whiff") and m.a.open_until > m.t
    m.a.guard = True                                  # guard up but open: the hook still lands clean
    ss = steps(m, 8)
    assert events(ss, "punch", who="house", result="hit")


def test_knockdown_and_ko_end_the_match():
    m = make("rookie")
    m.plan_turn(); m.turn_no = 1
    close(m)
    m.b.hp = 51
    m.on_gesture("P1", punch("jab", 1.0)); ss = steps(m, 4)
    assert m.b.state == "down" and any(s["flags"].get("slowmo") for s in ss) and m.b.knockdowns == 1 and not m.round_over
    for _ in range(int(m.down_s / 0.05) + 6):
        m.step()
    assert m.b.state == "idle"
    m.b.hp = 5
    m.a.x, m.b.x = -0.15, 0.15
    m.on_gesture("P1", punch("hook", 1.0)); ss = steps(m, 7)
    assert m.ko == "human" and m.round_over and m.input_done() and events(ss, "knockdown", who="house", ko=True)
    res = m.resolve()
    assert res.outcome == "human" and m.winner() == "human" and m.plan_turn() is None


def test_house_reacts_to_windup_by_tier_and_approaches_to_reach():
    cfg = Config.load()
    rook, boss = make("rookie", cfg=cfg), make("boss", cfg=cfg)
    reacts = {}
    for mm in (rook, boss):
        mm.plan_turn(); mm.turn_no = 1
        mm.b.house.base["aggression"] = 0.0
        mm.b.house.base["retreat_p"] = 0.0
        reacts[mm] = 0
        for i in range(120):
            mm.a.x, mm.b.x = -0.15, 0.15
            mm.a.stamina = 100.0
            mm.a.state, mm.a.action, mm.a.buffered = "idle", None, None
            mm.b.state, mm.b.hp, mm.b.house.react_at = "idle", 100.0, None
            mm.on_gesture("P1", punch("jab", 0.8)); ss = steps(mm, 6)
            reacts[mm] += len(events(ss, "react", who="house"))
    assert reacts[rook] == 0 and reacts[boss] > 40 and boss.b.blocked + boss.b.dodged + boss.b.parried > 40
    # the House walks into range on its own
    m = make("champion", cfg=cfg)
    m.plan_turn(); m.turn_no = 1
    assert m.distance() == 1.0
    ss = steps(m, 20)
    assert m.distance() < 0.5 and events(ss, "move", who="house") and abs(m.b.x - m.a.x) >= PHYS["min_gap"] - 1e-9


def test_tick_summary_shape():
    m = make("rookie")
    m.plan_turn(); m.turn_no = 1
    m.b.house.base["speed"] = 0.0
    s = m.step()
    f = s["fighters"]["human"]
    for k in ("x", "facing", "action", "phase", "progress", "reach", "moving", "fatigue", "dodge_ready", "hp", "stamina", "guard", "state"):
        assert k in f
    assert s["distance"] == 1.0 and s["ring"] == [-1.0, 1.0] and s["reach"]["hook"] > s["reach"]["jab"] and f["facing"] == 1 and s["fighters"]["house"]["facing"] == -1


def test_three_rounds_and_determinism():
    cfg = Config.load()
    a = make("contender", seed=7, cfg=cfg); b = make("contender", seed=7, cfg=cfg)
    for mm in (a, b):
        for _ in range(3):
            plan, _s = run_round(mm, inputs={5: move(1), 8: move(1), 20: punch("jab"), 60: punch("hook"), 120: Gesture("block_on", 0), 200: Gesture("block_off", 0)})
            if plan is not None:
                mm.resolve()
    assert a.summary() == b.summary()
    assert a.plan_turn() is None and len(a.round_winners) == a.round_no and (a.ko or a.round_no == 3)
    n_ticks = int(30 / 0.05)
    c = make("rookie", seed=3, cfg=cfg)
    c.a.hp = 10_000.0                                 # a punching bag: the round must run its full 30 s
    _, summ = run_round(c)
    assert len(summ) == n_ticks and summ[-1]["round_over"] and c.b.thrown > 0 and any(e["kind"] == "bell" for e in summ[-1]["events"])


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
    assert m.winner() in ("a", "b", "tie") and (m.a.thrown + m.b.thrown) > 10 and (m.a.landed + m.b.landed) > 0
    spec = m.match_winner_market()
    assert [o[0] for o in spec.outcomes] == ["a", "b"]
