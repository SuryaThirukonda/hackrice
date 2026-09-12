"""Boxing: fixed-tick simulation. Human punches/blocks/dodges arrive as gestures; the House runs a state machine.
Rounds are turns; the driver steps the sim during the 'input' phase and streams match.tick at 20 Hz."""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any

from ..agents.boxer import BoxerPolicy, HouseBoxer
from ..agents.policy import DecisionRequest, Option, TierConfig
from .base import Match, MarketSpec, TurnPlan, TurnResult


@dataclass
class Fighter:
    id: str
    name: str
    hp: float = 100.0
    stamina: float = 100.0
    guard: bool = False
    state: str = "idle"          # idle | telegraph | strike | recover | block | dodge | down
    state_until: float = 0.0
    pending_kind: str = "jab"
    pending_power: float = 0.6
    dodge_until: float = 0.0
    parry_bonus_until: float = 0.0
    open_until: float = 0.0
    knockdowns: int = 0
    dealt_round: float = 0.0
    dealt_total: float = 0.0
    landed: int = 0
    thrown: int = 0
    blocked: int = 0
    dodged: int = 0
    house: HouseBoxer | None = None
    knockdown_marks: list[float] = field(default_factory=lambda: [50.0, 0.0])
    second_wind: bool = False

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "hp": round(max(0.0, self.hp), 1), "stamina": round(self.stamina, 1), "guard": self.guard, "state": self.state,
                "knockdowns": self.knockdowns, "landed": self.landed, "thrown": self.thrown, "dealt_round": round(self.dealt_round, 1)}


class BoxingMatch(Match):
    sport = "boxing"

    def __init__(self, match_id, seed, tier: TierConfig, seats, players, config, scenario=None, card: tuple[str, str] | None = None):
        super().__init__(match_id, seed, tier, seats, players, config, scenario)
        g = config.get("game.boxing")
        self.card = card
        self.tick_ms = float(g["card_tick_ms"] if card else g["tick_ms"])
        self.round_s, self.rounds, self.rest_s, self.down_s = float(g["round_s"]), int(g["rounds"]), float(g["rest_s"]), float(g["down_s"])
        self.g = g
        self.t = 0.0                    # sim time in seconds (sum of steps)
        self.round_no = 0
        self.round_clock = 0.0
        self.events: list[dict[str, Any]] = []
        self.pending: list[tuple[str, Any]] = []   # (seat_id, gesture) applied on the next tick
        self.round_over = False
        self.ko: str | None = None
        self.flags: dict[str, bool] = {}
        self.round_winners: list[str] = []
        self.script = list(scenario.get("script", [])) if scenario else []
        self.script_i = 0
        if card:
            ta, tb = card
            ca, cb = config.tier("boxing", ta), config.tier("boxing", tb)
            self.a = Fighter("a", ca["name"], house=HouseBoxer(ca["params"], self.rng, "a"))
            self.b = Fighter("b", cb["name"], house=HouseBoxer(cb["params"], self.rng, "b"))
            self.tier_b = TierConfig.from_dict("boxing", cb)
            self.tier = TierConfig.from_dict("boxing", ca)
        else:
            human_name = ", ".join(players.values()) or "Player"
            self.a = Fighter("human", human_name)
            self.b = Fighter("house", tier.name, house=HouseBoxer(tier.params, self.rng, "house"))
            self.tier_b = None
        self.policy_a = BoxerPolicy(self.a.house.base) if self.a.house else None
        self.policy_b = BoxerPolicy(self.b.house.base) if self.b.house else None
        self.on_human_punch = None       # hook for the rhythm-learner boss (M10)

    # ---- framework -------------------------------------------------------------------------------
    def plan_turn(self) -> TurnPlan | None:
        if self.ko or self.round_no >= self.rounds:
            return None
        self.round_no += 1
        self.round_clock = 0.0
        self.round_over = False
        for f in (self.a, self.b):
            f.dealt_round = 0.0
            if f.state == "down":
                f.state = "idle"
            f.stamina = min(100.0, f.stamina + 25)
        label = f"Round {self.round_no}"
        outcomes = [(self.a.id, self.a.name), (self.b.id, self.b.name)]
        plan = TurnPlan(label=label, input_seats=list(self.seats), input_window_s=self.round_s,
                        markets=[MarketSpec("round_winner", f"{label} winner", outcomes)], prompt={"round": self.round_no})
        plan.tick_ms = self.tick_ms  # type: ignore[attr-defined]
        return plan

    def decisions_before(self, phase: str) -> list[DecisionRequest]:
        if phase != "input":
            return []
        reqs = []
        for f, pol, tier in ((self.a, self.policy_a, self.tier), (self.b, self.policy_b, self.tier_b or self.tier)):
            if pol is None:
                continue
            other = self.b if f is self.a else self.a
            state = {"round": self.round_no, "my_hp": f.hp, "their_hp": other.hp, "my_stamina": f.stamina, "their_landed": other.landed}
            opts = pol.options(state, self.rng)
            reqs.append(DecisionRequest(agent_id=f"house:boxing:{tier.id}:{f.id}", options=opts, default=pol.default(opts, self.rng), context=state, turn_no=self.turn_no, match_id=self.match_id))
        return reqs

    def apply_decision(self, req: DecisionRequest, option: Option) -> None:
        fid = req.agent_id.split(":")[-1]
        f = self.a if fid == "a" else self.b
        if f.house:
            f.house.set_option(option)

    def on_gesture(self, seat_id: str, gesture) -> bool:
        if gesture.kind not in ("punch", "block_on", "block_off", "dodge", "parry") or self.round_over:
            return False
        self.pending.append((seat_id, gesture))
        return True

    def input_done(self) -> bool:
        return self.round_over

    def no_input(self) -> None:
        self.round_over = True

    def match_winner_market(self) -> MarketSpec:
        return MarketSpec("match_winner", f"Fight: {self.a.name} vs {self.b.name}", [(self.a.id, self.a.name), (self.b.id, self.b.name)])

    # ---- simulation ------------------------------------------------------------------------------------
    def step(self, dt_s: float | None = None) -> dict[str, Any]:
        """Advance one tick. Returns the render summary for match.tick."""
        dt = (dt_s if dt_s is not None else self.tick_ms / 1000.0)
        self.events = []
        self.flags = {}
        if self.round_over:
            return self.tick_summary()
        self.t += dt
        self.round_clock += dt
        # human inputs
        for seat_id, g in self.pending:
            self._apply_human(self.a, g)
        self.pending.clear()
        # scripted House beats (demo scenario)
        if self.script and self.script_i < len(self.script) and self.b.house and self.b.state == "idle":
            beat = self.script[self.script_i]
            if self.round_clock >= float(beat.get("t", 0)) and self.round_no == int(beat.get("round", 1)):
                self.script_i += 1
                self._start_telegraph(self.b, float(beat.get("window_ms", self.b.house.param("telegraph_ms", 400))))
        for f in (self.a, self.b):
            if f.house:
                self._house_ai(f, dt)
            self._advance_state(f)
            f.stamina = min(100.0, f.stamina + (self.g["regen_block"] if f.state == "block" else self.g["regen_idle"]) * dt)
        if self.round_clock >= self.round_s:
            self.round_over = True
            self.events.append({"kind": "bell"})
        return self.tick_summary()

    def _other(self, f: Fighter) -> Fighter:
        return self.b if f is self.a else self.a

    def _apply_human(self, f: Fighter, g) -> None:
        if f.state == "down":
            return
        if g.kind == "punch":
            kind = str(g.extra.get("type", "jab"))
            if self.on_human_punch:
                self.on_human_punch(self.t, kind)
            cost = self.g["hook_stamina"] if kind == "hook" else self.g["jab_stamina"]
            if f.stamina < cost:
                self.events.append({"kind": "gassed", "who": f.id})
                return
            f.stamina -= cost
            f.thrown += 1
            other = self._other(f)
            # the defender may react (House) or already be guarding/dodging
            if other.house and other.state in ("idle", "recover"):
                r = other.house.reacts_to_punch(float(g.duration_ms or 80))
                if r == "block":
                    other.state, other.state_until, other.guard = "block", self.t + 0.35, True
                    if other.house.base.get("counter"):
                        other.house.counter_pending = True
                elif r == "dodge":
                    other.state, other.state_until, other.dodge_until = "dodge", self.t + 0.3, self.t + 0.3
            self._land(f, other, kind, float(g.power))
        elif g.kind == "block_on":
            f.guard = True
            if f.state == "idle":
                f.state = "block"
        elif g.kind == "block_off":
            f.guard = False
            if f.state == "block":
                f.state = "idle"
        elif g.kind == "dodge":
            f.dodge_until = self.t + self.g["dodge_window_ms"] / 1000.0
            f.state, f.state_until = "dodge", self.t + 0.3
        elif g.kind == "parry":
            other = self._other(f)
            # a parry lands if the opponent is winding up (telegraph) or has just started the strike
            if other.state == "telegraph" or (other.state == "strike" and other.state_until - self.t > 0.08):
                other.state, other.state_until, other.guard = "stunned", self.t + 0.9, False
                if other.house:
                    other.house.counter_pending = False
                f.parry_bonus_until = self.t + 1.5
                self.flags["hitstop"] = True
                self.events.append({"kind": "parry", "who": f.id, "result": "success"})
            else:
                f.open_until = self.t + 0.35   # whiffed parry: briefly open
                f.guard = False
                if f.state == "block":
                    f.state = "idle"
                self.events.append({"kind": "parry", "who": f.id, "result": "whiff"})

    def _land(self, attacker: Fighter, defender: Fighter, kind: str, power: float) -> None:
        dmg = self.g["jab_dmg"] + self.g["power_dmg"] * max(0.0, min(1.0, power))
        if kind == "hook":
            dmg *= self.g["hook_mult"]
        if attacker.house and attacker.house.counter_pending:
            dmg *= 1.3
            attacker.house.counter_pending = False
        if self.t < attacker.parry_bonus_until:
            dmg *= 1.5
            attacker.parry_bonus_until = 0.0
        result = "hit"
        if defender.state == "down":
            return
        if defender.state == "stunned":
            dmg *= 1.25
        if self.t < defender.dodge_until or defender.state == "dodge":
            dmg, result = 0.0, "dodged"
            defender.dodged += 1
        elif (defender.guard or defender.state == "block") and self.t >= defender.open_until:
            dmg *= self.g["block_mult"]
            result = "blocked"
            defender.blocked += 1
        if result == "hit":
            attacker.landed += 1
            self.flags["shake"] = True
            if kind == "hook":
                self.flags["hitstop"] = True
        before = defender.hp
        defender.hp = max(0.0, defender.hp - dmg)
        attacker.dealt_round += dmg
        attacker.dealt_total += dmg
        self.events.append({"kind": "punch", "who": attacker.id, "type": kind, "result": result, "dmg": round(dmg, 1)})
        for mark in list(defender.knockdown_marks):
            if before > mark >= defender.hp:
                defender.knockdown_marks.remove(mark)
                defender.knockdowns += 1
                defender.state, defender.state_until, defender.guard = "down", self.t + self.down_s, False
                self.flags["slowmo"] = True
                self.events.append({"kind": "knockdown", "who": defender.id, "ko": defender.hp <= 0})
                if defender.hp <= 0:
                    self.ko = attacker.id
                    self.round_over = True
                break

    def _start_telegraph(self, f: Fighter, telegraph_ms: float) -> None:
        assert f.house
        f.pending_kind = f.house.next_punch()
        f.pending_power = self.rng.uniform(0.5, 1.0)
        f.state, f.state_until, f.guard = "telegraph", self.t + telegraph_ms / 1000.0, False
        self.events.append({"kind": "telegraph", "who": f.id, "type": f.pending_kind, "ms": int(telegraph_ms)})

    def _house_ai(self, f: Fighter, dt: float) -> None:
        h = f.house
        assert h
        if f.state != "idle" or self.t < f.open_until:
            return
        cost = self.g["hook_stamina"] if f.pending_kind == "hook" else self.g["jab_stamina"]
        if h.counter_pending and f.stamina >= cost:
            f.pending_kind, f.pending_power = "jab", 0.9
            f.state, f.state_until = "strike", self.t + 0.05
            return
        if f.stamina >= cost and h.wants_to_attack(dt, self.t):
            self._start_telegraph(f, h.param("telegraph_ms", 400))
            return
        gd = h.wants_guard(self.t) if self.rng.random() < dt * 2 else 0.0
        if gd:
            f.state, f.state_until, f.guard = "block", self.t + gd, True

    def _advance_state(self, f: Fighter) -> None:
        if f.state == "idle" or self.t < f.state_until:
            return
        if f.state == "telegraph":
            f.state, f.state_until = "strike", self.t + 0.15
            other = self._other(f)
            cost = self.g["hook_stamina"] if f.pending_kind == "hook" else self.g["jab_stamina"]
            f.stamina = max(0.0, f.stamina - cost)
            f.thrown += 1
            self._land(f, other, f.pending_kind, f.pending_power)
        elif f.state == "strike":
            f.state, f.state_until = "recover", self.t + 0.3
        elif f.state == "recover":
            f.state = "idle"
        elif f.state == "block":
            if f.house:
                f.state, f.guard = "idle", False
            elif not f.guard:
                f.state = "idle"
            else:
                f.state_until = self.t + 1.0
        elif f.state == "dodge":
            f.state = "idle"
        elif f.state == "stunned":
            f.state = "idle"
        elif f.state == "down":
            if f.hp > 0:
                f.state, f.stamina = "idle", max(f.stamina, 40.0)

    def tick_summary(self) -> dict[str, Any]:
        return {"t": round(self.t, 2), "round": self.round_no, "clock_s": round(self.round_clock, 2), "round_s": self.round_s,
                "fighters": {self.a.id: self.a.public(), self.b.id: self.b.public()}, "events": list(self.events), "flags": dict(self.flags),
                "round_over": self.round_over, "ko": self.ko, "card": bool(self.card)}

    # ---- resolution -------------------------------------------------------------------------------------
    def resolve(self) -> TurnResult:
        a, b = self.a, self.b
        if self.ko:
            winner = self.ko
        elif a.dealt_round > b.dealt_round:
            winner = a.id
        elif b.dealt_round > a.dealt_round:
            winner = b.id
        else:
            winner = "draw"
        self.round_winners.append(winner)
        triggers = []
        if self.ko:
            triggers.append(("knockdown", {"loser": (b if self.ko == a.id else a).name, "ko": True}))
        else:
            triggers.append(("turn_result", {"outcome": f"Round {self.round_no} to {a.name if winner == a.id else b.name if winner == b.id else 'nobody'}", "player": a.name}))
        winners = [winner] if winner != "draw" else [a.id, b.id]
        detail = {"round": self.round_no, "winner": winner, "ko": self.ko, "a": a.public(), "b": b.public()}
        return TurnResult(outcome=winner, detail=detail, score=self.summary(), market_winners={"round_winner": winners}, triggers=triggers,
                          animation_s=2.5 if not self.ko else 4.0, ticks=[self.tick_summary() | {"final": True}])

    def summary(self) -> dict[str, Any]:
        return {"round": self.round_no, "rounds": self.rounds, "fighters": {self.a.id: self.a.public(), self.b.id: self.b.public()},
                "round_winners": self.round_winners, "ko": self.ko, "card": bool(self.card)}

    def winner(self) -> str:
        if self.ko:
            return self.ko
        ra, rb = self.round_winners.count(self.a.id), self.round_winners.count(self.b.id)
        if ra != rb:
            return self.a.id if ra > rb else self.b.id
        if self.a.hp != self.b.hp:
            return self.a.id if self.a.hp > self.b.hp else self.b.id
        return "tie"

    def grant_second_wind(self) -> None:
        self.a.stamina = 100.0
        self.a.hp = min(100.0, self.a.hp + 15)
