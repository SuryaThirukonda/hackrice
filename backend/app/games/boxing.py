"""Boxing: real-time fixed-tick simulation with ring positions and hit physics.

Both fighters (human or House) run the same punch pipeline: windup -> active -> recover. A punch connects only while the
opponent is inside its reach during the active window (jabs are short and fast, hooks long and slow), then applies damage,
knockback and a stagger. Blocks absorb most damage (chip damage, a little stamina), a parry pressed inside the window right
before the active phase nullifies the hit and stuns the attacker, dodges are short invulnerable sidesteps with a cooldown, and
`move` inputs are footwork at a capped speed. Stamina drains on punches/dodges/blocked hits, regenerates while idle or guarding,
and low stamina slows windups and softens hits. Knockdowns at hp 50 and 0 (KO ends the match). Rounds are turns; the driver
steps the sim during the 'input' phase and streams match.tick at 20 Hz.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..agents.boxer import BoxerPolicy, HouseBoxer
from ..agents.policy import DecisionRequest, Option, TierConfig
from .base import Match, MarketSpec, TurnPlan, TurnResult

# Physics constants. Any of these may be overridden from config `game.boxing.<key>` (host set_param) without code changes.
PHYS: dict[str, float] = {
    "ring_half": 1.0, "start_x": 0.5, "min_gap": 0.22,
    "jab_reach": 0.40, "hook_reach": 0.50,
    "jab_windup_ms": 120, "hook_windup_ms": 220, "active_ms": 80, "jab_recover_ms": 180, "hook_recover_ms": 320,
    "jab_lunge": 0.05, "hook_lunge": 0.08,
    "move_speed": 1.3, "guard_move_mult": 0.6, "move_hold_s": 0.35,
    "jab_kb": 0.07, "hook_kb": 0.13, "block_kb": 0.03, "jab_stagger_ms": 160, "hook_stagger_ms": 320,
    "block_stamina_jab": 3, "block_stamina_hook": 5,
    "parry_window_ms": 150, "parry_stun_ms": 900, "parry_open_ms": 300, "parry_bonus_s": 1.5, "parry_bonus_mult": 1.5,
    "dodge_invuln_ms": 250, "dodge_state_ms": 300, "dodge_cooldown_ms": 600, "dodge_stamina": 6, "dodge_shift": 0.12,
    "fatigue_at": 40, "fatigue_windup_mult": 0.7, "fatigue_dmg_mult": 0.4, "stunned_dmg_mult": 1.25, "counter_mult": 1.3,
    "house_block_s": 0.35, "buffer_s": 0.4,
}

BUSY = ("windup", "active", "recover", "stagger", "stunned", "down", "dodge", "parry")


@dataclass
class Fighter:
    id: str
    name: str
    hp: float = 100.0
    stamina: float = 100.0
    x: float = 0.0
    facing: int = 1
    guard: bool = False            # human: guard button held (all gloves)
    state: str = "idle"            # idle | block | windup | active | recover | dodge | parry | stagger | stunned | down
    state_until: float = 0.0
    phase_t0: float = 0.0
    action: str | None = None      # jab | hook while in windup/active/recover
    action_power: float = 0.6
    action_id: int = 0
    action_resolved: bool = False
    action_windup_ms: float = 0.0
    action_fatigue: float = 0.0
    buffered: tuple[str, float] | None = None
    move_dir: int = 0
    move_until: float = 0.0
    dodge_until: float = 0.0
    dodge_ready_at: float = 0.0
    parry_until: float = 0.0
    parry_bonus_until: float = 0.0
    open_until: float = 0.0
    knockdowns: int = 0
    dealt_round: float = 0.0
    dealt_total: float = 0.0
    landed: int = 0
    thrown: int = 0
    blocked: int = 0
    dodged: int = 0
    parried: int = 0
    house: HouseBoxer | None = None
    knockdown_marks: list[float] = field(default_factory=lambda: [50.0, 0.0])
    second_wind: bool = False
    # legacy aliases kept for callers that poked these directly
    pending_kind: str = "jab"
    pending_power: float = 0.6

    def public(self, t: float = 0.0, reach: float = 0.0, fatigue: float = 0.0) -> dict[str, Any]:
        in_action = self.state in ("windup", "active", "recover")
        span = max(1e-6, self.state_until - self.phase_t0)
        progress = max(0.0, min(1.0, (t - self.phase_t0) / span)) if self.state != "idle" and self.state != "block" else 0.0
        return {"id": self.id, "name": self.name, "hp": round(max(0.0, self.hp), 1), "stamina": round(self.stamina, 1),
                "guard": self.guard or self.state == "block", "state": self.state,
                "x": round(self.x, 3), "facing": self.facing, "action": self.action if in_action else None,
                "phase": self.state if in_action else None, "progress": round(progress, 2), "reach": round(reach, 3),
                "moving": self.move_dir if t < self.move_until and self.state in ("idle", "block") else 0,
                "fatigue": round(fatigue, 2), "dodge_ready": t >= self.dodge_ready_at, "open": t < self.open_until,
                "knockdowns": self.knockdowns, "landed": self.landed, "thrown": self.thrown, "blocked": self.blocked, "dodged": self.dodged,
                "parried": self.parried, "dealt_round": round(self.dealt_round, 1)}


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
        self.on_human_punch = None       # hook for the rhythm-learner boss
        self.rhythm = None
        self.guard_seats: set[str] = set()   # two-glove: guard requires every glove up
        self._reset_positions()

    # ---- constants ---------------------------------------------------------------------------------
    def p(self, key: str) -> float:
        return float(self.g.get(key, PHYS[key]))

    def reach(self, kind: str | None) -> float:
        return self.p("hook_reach") if kind == "hook" else self.p("jab_reach")

    def fatigue(self, f: Fighter) -> float:
        return max(0.0, 1.0 - f.stamina / max(1e-6, self.p("fatigue_at")))

    def distance(self) -> float:
        return abs(self.b.x - self.a.x)

    def due(self, until: float) -> bool:
        return self.t + 1e-6 >= until          # tick times accumulate float error; never miss a boundary by 1e-16

    def _reset_positions(self) -> None:
        self.a.x, self.b.x = -self.p("start_x"), self.p("start_x")
        self.a.facing, self.b.facing = 1, -1

    # ---- framework -------------------------------------------------------------------------------
    def plan_turn(self) -> TurnPlan | None:
        if self.ko or self.round_no >= self.rounds:
            return None
        self.round_no += 1
        self.round_clock = 0.0
        self.round_over = False
        self.pending.clear()
        self._reset_positions()
        for f in (self.a, self.b):
            f.dealt_round = 0.0
            f.state, f.action, f.buffered, f.move_until, f.move_dir = "idle", None, None, 0.0, 0
            f.action_resolved = True
            f.stamina = min(100.0, f.stamina + 25)
            if f.house:
                f.house.react_at = None
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
        if gesture.kind not in ("punch", "block_on", "block_off", "dodge", "parry", "move") or self.round_over:
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
    def step(self, dt_s: float | None = None, now: float | None = None) -> dict[str, Any]:
        """Advance one tick. Returns the render summary for match.tick."""
        dt = (dt_s if dt_s is not None else self.tick_ms / 1000.0)
        self.events = []
        self.flags = {}
        if self.round_over:
            return self.tick_summary()
        self.t += dt
        self.round_clock += dt
        # facing always toward the opponent
        if self.a.x != self.b.x:
            self.a.facing = 1 if self.b.x > self.a.x else -1
            self.b.facing = -self.a.facing
        # human inputs
        for seat_id, g in self.pending:
            self._apply_human(self.a, g, seat_id)
        self.pending.clear()
        # scripted House beats (demo scenario)
        if self.script and self.script_i < len(self.script) and self.b.house and self.b.state == "idle":
            beat = self.script[self.script_i]
            if self.round_clock >= float(beat.get("t", 0)) and self.round_no == int(beat.get("round", 1)):
                self.script_i += 1
                self._start_punch(self.b, self.b.house.next_punch(), self.rng.uniform(0.5, 1.0), windup_ms=float(beat.get("window_ms", self.b.house.param("telegraph_ms", 400))))
        for f in (self.a, self.b):
            if f.house:
                self._house_ai(f, dt)
        for f in (self.a, self.b):
            self._footwork(f, dt)
            self._advance_state(f)
            if self.round_over:
                break
            if f.state == "block":
                f.stamina = min(100.0, f.stamina + float(self.g["regen_block"]) * dt)
            elif f.state == "idle":
                f.stamina = min(100.0, f.stamina + float(self.g["regen_idle"]) * dt)
        if not self.round_over and self.round_clock >= self.round_s:
            self.round_over = True
            self.events.append({"kind": "bell", "round": self.round_no})
        return self.tick_summary()

    def _other(self, f: Fighter) -> Fighter:
        return self.b if f is self.a else self.a

    # ---- human inputs -----------------------------------------------------------------------------------
    def _apply_human(self, f: Fighter, g, seat_id: str | None = None) -> None:
        if f.state == "down":
            return
        seat = getattr(g, "seat_id", None) or seat_id or "P1"
        if g.kind == "punch":
            kind = str(g.extra.get("type", "jab"))
            if kind not in ("jab", "hook"):
                kind = "jab"
            if self.on_human_punch:
                self.on_human_punch(self.t, kind)
            power = max(0.0, min(1.0, float(g.power)))
            if f.state in ("idle", "block"):
                self._start_punch(f, kind, power)
            elif f.state in ("active", "recover") or (f.state == "windup" and f.action_resolved):
                f.buffered = (kind, power)          # input buffer: fires as soon as the fighter is free
            else:
                self.events.append({"kind": "busy", "who": f.id, "state": f.state})
        elif g.kind == "block_on":
            self.guard_seats.add(seat)
            if len(self.guard_seats) >= max(1, len(self.seats)):
                f.guard = True
                if f.state == "idle" and self.t >= f.open_until:
                    self._enter(f, "block", 1.0)
        elif g.kind == "block_off":
            self.guard_seats.discard(seat)
            f.guard = False
            if f.state == "block":
                self._enter(f, "idle", 0.0)
        elif g.kind == "dodge":
            d = g.extra.get("dir")
            direction = int(d) if d not in (None, 0, "0") else -f.facing
            self._dodge(f, direction)
        elif g.kind == "parry":
            self._parry(f)
        elif g.kind == "move":
            d = int(g.extra.get("dir", 0) or 0)
            if d == 0:
                f.move_until, f.move_dir = 0.0, 0
                self.events.append({"kind": "move", "who": f.id, "dir": 0})
            else:
                if f.move_dir != d or self.t >= f.move_until:
                    self.events.append({"kind": "move", "who": f.id, "dir": 1 if d > 0 else -1})
                f.move_dir, f.move_until = (1 if d > 0 else -1), self.t + self.p("move_hold_s")

    # ---- actions shared by human and House ---------------------------------------------------------------
    def _enter(self, f: Fighter, state: str, dur_s: float) -> None:
        f.state, f.phase_t0, f.state_until = state, self.t, self.t + dur_s

    def _start_punch(self, f: Fighter, kind: str, power: float, windup_ms: float | None = None) -> bool:
        cost = float(self.g["hook_stamina"] if kind == "hook" else self.g["jab_stamina"])
        if f.stamina < cost:
            self.events.append({"kind": "gassed", "who": f.id})
            return False
        low = self.fatigue(f)              # sampled before the cost: tired fighters wind up slowly and hit softly
        f.stamina -= cost
        f.thrown += 1
        base = windup_ms if windup_ms is not None else self.p("hook_windup_ms" if kind == "hook" else "jab_windup_ms")
        windup = base * (1.0 + self.p("fatigue_windup_mult") * low)
        f.action, f.action_power, f.action_resolved = kind, power, False
        f.action_fatigue = low
        f.action_id += 1
        f.action_windup_ms = windup
        f.pending_kind, f.pending_power = kind, power
        f.guard = f.guard  # guard intent survives; the block resumes after recovery
        self._enter(f, "windup", windup / 1000.0)
        self.events.append({"kind": "windup", "who": f.id, "type": kind, "ms": int(round(windup)), "power": round(power, 2)})
        return True

    def _dodge(self, f: Fighter, direction: int) -> bool:
        if f.state not in ("idle", "block", "recover") or self.t < f.dodge_ready_at:
            return False
        cost = self.p("dodge_stamina")
        if f.stamina < cost:
            self.events.append({"kind": "gassed", "who": f.id})
            return False
        f.stamina -= cost
        f.dodge_until = self.t + self.p("dodge_invuln_ms") / 1000.0
        f.dodge_ready_at = self.t + self.p("dodge_cooldown_ms") / 1000.0
        self._enter(f, "dodge", self.p("dodge_state_ms") / 1000.0)
        self._shift(f, direction * self.p("dodge_shift"))
        self.events.append({"kind": "dodge", "who": f.id, "dir": direction})
        return True

    def _parry(self, f: Fighter) -> bool:
        if f.state not in ("idle", "block"):
            return False
        f.parry_until = self.t + self.p("parry_window_ms") / 1000.0
        self._enter(f, "parry", self.p("parry_window_ms") / 1000.0)
        return True

    def _shift(self, f: Fighter, dx: float) -> float:
        """Move a fighter by dx, clamped to the ropes and to the minimum gap to the opponent. Returns the applied delta."""
        other = self._other(f)
        half, gap = self.p("ring_half"), self.p("min_gap")
        nx = max(-half, min(half, f.x + dx))
        if (dx > 0 and other.x > f.x) or (dx < 0 and other.x < f.x):
            if abs(other.x - nx) < gap:
                nx = other.x - gap if other.x > f.x else other.x + gap
                if (dx > 0 and nx < f.x) or (dx < 0 and nx > f.x):
                    nx = f.x
        applied = nx - f.x
        f.x = nx
        return applied

    def _footwork(self, f: Fighter, dt: float) -> None:
        if f.state not in ("idle", "block") or f.move_dir == 0 or self.due(f.move_until):
            return
        speed = self.p("move_speed") * (f.house.param("speed", 1.0) if f.house else 1.0)
        if f.state == "block":
            speed *= self.p("guard_move_mult")
        self._shift(f, f.move_dir * speed * dt)

    # ---- resolution of a punch -------------------------------------------------------------------------
    def _try_contact(self, f: Fighter) -> None:
        if f.action_resolved or f.action is None:
            return
        other = self._other(f)
        if self.distance() <= self.reach(f.action):
            f.action_resolved = True
            self._land(f, other, f.action, f.action_power)

    def _land(self, attacker: Fighter, defender: Fighter, kind: str, power: float) -> None:
        if defender.state == "down":
            self.events.append({"kind": "punch", "who": attacker.id, "type": kind, "result": "whiff", "dmg": 0, "kb": 0})
            return
        dmg = float(self.g["jab_dmg"]) + float(self.g["power_dmg"]) * max(0.0, min(1.0, power))
        if kind == "hook":
            dmg *= float(self.g["hook_mult"])
        if attacker.house and attacker.house.counter_pending:
            dmg *= self.p("counter_mult")
            attacker.house.counter_pending = False
        if self.t < attacker.parry_bonus_until:
            dmg *= self.p("parry_bonus_mult")
            attacker.parry_bonus_until = 0.0
        dmg *= 1.0 - self.p("fatigue_dmg_mult") * attacker.action_fatigue
        if defender.state == "stunned":
            dmg *= self.p("stunned_dmg_mult")
        kb = 0.0
        if self.t < defender.dodge_until:
            dmg, result = 0.0, "dodged"
            defender.dodged += 1
        elif defender.state == "parry" and self.t <= defender.parry_until:
            dmg, result = 0.0, "parried"
            defender.parried += 1
            defender.parry_bonus_until = self.t + self.p("parry_bonus_s")
            self._enter(defender, "block" if defender.guard else "idle", 1.0 if defender.guard else 0.0)
            self._enter(attacker, "stunned", self.p("parry_stun_ms") / 1000.0)
            attacker.action_resolved, attacker.buffered = True, None
            if attacker.house:
                attacker.house.counter_pending = False
            self.flags["hitstop"] = True
            self.events.append({"kind": "parry", "who": defender.id, "result": "success"})
        elif defender.state == "block" and self.t >= defender.open_until:
            dmg *= float(self.g["block_mult"])
            result = "blocked"
            defender.blocked += 1
            defender.stamina = max(0.0, defender.stamina - self.p("block_stamina_hook" if kind == "hook" else "block_stamina_jab"))
            kb = self._shift(defender, (1 if defender.x >= attacker.x else -1) * self.p("block_kb"))
        else:
            result = "hit"
            attacker.landed += 1
            self.flags["shake"] = True
            if kind == "hook":
                self.flags["hitstop"] = True
            strength = 0.6 + 0.4 * max(0.0, min(1.0, power))
            kb = self._shift(defender, (1 if defender.x >= attacker.x else -1) * self.p("hook_kb" if kind == "hook" else "jab_kb") * strength)
            # a clean hit interrupts whatever the defender was doing
            defender.action_resolved, defender.buffered = True, None
            self._enter(defender, "stagger", self.p("hook_stagger_ms" if kind == "hook" else "jab_stagger_ms") / 1000.0)
            self.events.append({"kind": "stagger", "who": defender.id, "ms": int(self.p("hook_stagger_ms" if kind == "hook" else "jab_stagger_ms"))})
        before = defender.hp
        defender.hp = max(0.0, defender.hp - dmg)
        attacker.dealt_round += dmg
        attacker.dealt_total += dmg
        self.events.append({"kind": "punch", "who": attacker.id, "type": kind, "result": result, "dmg": round(dmg, 1), "kb": round(abs(kb), 3)})
        for mark in list(defender.knockdown_marks):
            if before > mark >= defender.hp:
                defender.knockdown_marks.remove(mark)
                defender.knockdowns += 1
                defender.guard = False
                self._enter(defender, "down", self.down_s)
                self.flags["slowmo"] = True
                self.events.append({"kind": "knockdown", "who": defender.id, "ko": defender.hp <= 0})
                if defender.hp <= 0:
                    self.ko = attacker.id
                    self.round_over = True
                break

    # ---- House AI ----------------------------------------------------------------------------------------
    def _house_ai(self, f: Fighter, dt: float) -> None:
        h = f.house
        assert h
        other = self._other(f)
        if f.state == "down":
            return
        # 1. read the opponent's windup; decide after reaction_ms whether to block/dodge/parry
        if other.state == "windup" and not other.action_resolved and h.seen_action != other.action_id:
            h.seen_action = other.action_id
            time_to_hit = other.action_windup_ms + self.p("active_ms") * 0.5
            r = h.reacts_to_punch(time_to_hit)
            if r:
                h.react_at, h.react_kind = self.t + h.param("reaction_ms", 400) / 1000.0, r
        if h.react_at is not None and self.due(h.react_at):
            r, h.react_at = h.react_kind, None
            if other.state in ("windup", "active") and not other.action_resolved and f.state in ("idle", "block", "recover"):
                if r == "block":
                    f.guard = False
                    self._enter(f, "block", self.p("house_block_s") + 0.15)
                    if h.base.get("counter"):
                        h.counter_pending = True
                    self.events.append({"kind": "react", "who": f.id, "action": "block"})
                elif r == "dodge":
                    if self._dodge(f, -f.facing):
                        self.events.append({"kind": "react", "who": f.id, "action": "dodge"})
                elif r == "parry" and f.state in ("idle", "block"):
                    self._parry(f)
                    self.events.append({"kind": "react", "who": f.id, "action": "parry"})
        # 2. rhythm learner (boss twist): guard on the predicted beat
        if self.rhythm is not None and f is self.b and f.state in ("idle", "recover", "block"):
            g = self.rhythm.guard_now(self.t)
            if g == "block":
                f.guard = False
                self._enter(f, "block", 0.45)
                h.counter_pending = True
                self.events.append({"kind": "rhythm", "who": f.id, "action": "block"})
                return
            if g == "dodge" and self._dodge(f, -f.facing):
                h.counter_pending = True
                self.events.append({"kind": "rhythm", "who": f.id, "action": "dodge"})
                return
        if f.state not in ("idle", "block") or self.t < f.open_until:
            return
        dist = self.distance()
        want = h.param("range", self.p("jab_reach") - 0.06)
        # 3. footwork: close to the preferred range (or back off after a flurry)
        if f.state == "idle" and dist > want + 0.05:
            if f.move_dir != f.facing or self.t >= f.move_until:
                self.events.append({"kind": "move", "who": f.id, "dir": f.facing})
            f.move_dir, f.move_until = f.facing, self.t + dt * 1.5      # re-evaluated every tick: no overshoot
            return
        if f.state != "idle":
            return                                   # guarding: hold it until it expires, then counter/attack
        # 4. attack: punish an opponent stuck in recovery/stagger (they cannot guard), counter after a block, or press per aggression
        if other.state in ("recover", "stagger", "stunned") and h.punished_action != other.action_id and dist <= self.reach("jab") and f.state == "idle":
            h.punished_action = other.action_id
            if self.rng.random() < h.param("punish_p", 0.0) and self._start_punch(f, "jab", self.rng.uniform(0.6, 1.0), windup_ms=self._house_windup(h, "jab")):
                self.events.append({"kind": "react", "who": f.id, "action": "punish"})
                return
        if h.counter_pending and dist <= self.reach("jab"):
            if self._start_punch(f, "jab", 0.9):
                return
            h.counter_pending = False
        if f.state == "idle" and h.wants_to_attack(dt, self.t):
            kind = h.next_punch()
            if dist <= self.reach(kind):
                self._start_punch(f, kind, self.rng.uniform(0.5, 1.0), windup_ms=self._house_windup(h, kind))
                return
        # 5. guard for a while or step back
        if f.state == "idle" and self.rng.random() < dt * 2:
            gd = h.wants_guard(self.t)
            if gd:
                f.guard = False
                self._enter(f, "block", gd)
                return
            if self.rng.random() < h.param("retreat_p", 0.0) and f.x * -f.facing < self.p("ring_half") - 0.15:
                f.move_dir, f.move_until = -f.facing, self.t + 0.3
                self.events.append({"kind": "move", "who": f.id, "dir": -f.facing})

    def _house_windup(self, h: HouseBoxer, kind: str) -> float:
        tele = h.param("telegraph_ms", 400)
        base = self.p("hook_windup_ms" if kind == "hook" else "jab_windup_ms")
        return max(base, tele * (1.0 if kind == "hook" else 0.7))

    # ---- state machine -------------------------------------------------------------------------------------
    def _advance_state(self, f: Fighter) -> None:
        s = f.state
        if s == "idle":
            if f.guard and self.t >= f.open_until:
                self._enter(f, "block", 1.0)
            self._fire_buffer(f)
            return
        if s == "block":
            if not f.house and f.guard:
                f.state_until = self.t + 1.0
            elif self.due(f.state_until):
                self._enter(f, "idle", 0.0)
            self._fire_buffer(f)
            return
        if s == "windup":
            if self.due(f.state_until):
                self._enter(f, "active", self.p("active_ms") / 1000.0)
                self._shift(f, f.facing * self.p("hook_lunge" if f.action == "hook" else "jab_lunge"))
                self._try_contact(f)
            return
        if s == "active":
            self._try_contact(f)
            if f.state != "active":          # stunned by a parry during contact
                return
            if self.due(f.state_until):
                if not f.action_resolved:
                    f.action_resolved = True
                    self.events.append({"kind": "punch", "who": f.id, "type": f.action, "result": "whiff", "dmg": 0, "kb": 0})
                self._enter(f, "recover", self.p("hook_recover_ms" if f.action == "hook" else "jab_recover_ms") / 1000.0)
            return
        if not self.due(f.state_until):
            return
        if s == "recover":
            f.action = None
            self._enter(f, "block" if (f.guard and self.t >= f.open_until) else "idle", 1.0 if f.guard else 0.0)
            self._fire_buffer(f)
        elif s == "dodge":
            self._enter(f, "block" if f.guard else "idle", 1.0 if f.guard else 0.0)
        elif s == "parry":
            f.open_until = self.t + self.p("parry_open_ms") / 1000.0
            self._enter(f, "idle", 0.0)
            self.events.append({"kind": "parry", "who": f.id, "result": "whiff"})
        elif s == "stagger":
            f.action = None
            self._enter(f, "block" if f.guard else "idle", 1.0 if f.guard else 0.0)
        elif s == "stunned":
            f.action = None
            self._enter(f, "idle", 0.0)
        elif s == "down":
            if f.hp > 0:
                f.action, f.buffered = None, None
                f.stamina = max(f.stamina, 40.0)
                self._enter(f, "idle", 0.0)

    def _fire_buffer(self, f: Fighter) -> None:
        if f.buffered and f.state in ("idle", "block"):
            kind, power = f.buffered
            f.buffered = None
            self._start_punch(f, kind, power)

    def tick_summary(self) -> dict[str, Any]:
        return {"t": round(self.t, 2), "round": self.round_no, "clock_s": round(self.round_clock, 2), "round_s": self.round_s,
                "fighters": {self.a.id: self._pub(self.a), self.b.id: self._pub(self.b)}, "events": list(self.events), "flags": dict(self.flags),
                "round_over": self.round_over, "ko": self.ko, "card": bool(self.card),
                "distance": round(self.distance(), 3), "ring": [-self.p("ring_half"), self.p("ring_half")],
                "reach": {"jab": self.p("jab_reach"), "hook": self.p("hook_reach")}}

    def _pub(self, f: Fighter) -> dict[str, Any]:
        return f.public(self.t, self.reach(f.action), self.fatigue(f))

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
        detail = {"round": self.round_no, "winner": winner, "ko": self.ko, "a": self._pub(a), "b": self._pub(b)}
        return TurnResult(outcome=winner, detail=detail, score=self.summary(), market_winners={"round_winner": winners}, triggers=triggers,
                          animation_s=2.5 if not self.ko else 4.0, ticks=[self.tick_summary() | {"final": True}])

    def summary(self) -> dict[str, Any]:
        return {"round": self.round_no, "rounds": self.rounds, "fighters": {self.a.id: self._pub(self.a), self.b.id: self._pub(self.b)},
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

    def match_winner_market_seed(self) -> dict[str, int] | None:
        return None

    def grant_second_wind(self) -> None:
        self.a.stamina = 100.0
        self.a.hp = min(100.0, self.a.hp + 15)
