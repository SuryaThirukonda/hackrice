"""Bowling: lane path from (lane, speed, spin), pin-fall table for full racks, geometry for partial racks, ten-pin scoring.
Lane units: x in [-1, 1] between the gutters, d in [0, 1] from foul line to pin deck. Pins spaced 12 in on a 41.5 in lane."""
from __future__ import annotations

import math
import random
from typing import Any

from ..agents.bowler import BowlerPolicy
from ..agents.policy import DecisionRequest, Option
from .base import Match, MarketSpec, TurnPlan, TurnResult

S = 0.289  # one pin spacing in lane units
PIN_X: dict[int, float] = {1: 0.0, 2: -S, 3: S, 4: -2 * S, 5: 0.0, 6: 2 * S, 7: -3 * S, 8: -S, 9: S, 10: 3 * S}
PIN_ROW: dict[int, int] = {1: 0, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 3}
BEHIND: dict[int, list[int]] = {1: [2, 3], 2: [4, 5], 3: [5, 6], 4: [7, 8], 5: [8, 9], 6: [9, 10], 7: [], 8: [], 9: [], 10: []}
BALL_R = 0.21
ALL_PINS = frozenset(range(1, 11))


def ball_path(lane: float, speed: float, spin: float, hand: int, k_hook: float = 0.8, drift: float = 0.0, n: int = 12) -> list[tuple[float, float]]:
    """x(d) = lane + drift·d - hand·k_hook·clamp(spin/400)·(1 - 0.5·speed)·d²   (a right-hander's hook curves left)."""
    spin_norm = max(-1.0, min(1.0, spin / 400.0))
    pts = []
    for i in range(n + 1):
        d = i / n
        x = lane + drift * d - hand * k_hook * spin_norm * (1 - 0.5 * speed) * d * d
        pts.append((d, x))
    return pts


def first_ball(x_e: float, theta: float, speed: float, hand: int, rng: random.Random, pocket: float = 0.29, force_strike_if_err_below: float | None = None) -> set[int]:
    """Pin-fall table for a full rack keyed by pocket error. Returns the set of pins knocked down."""
    err = abs(x_e - hand * pocket)
    if force_strike_if_err_below is not None and err < force_strike_if_err_below:
        return set(ALL_PINS)
    if abs(x_e) < 0.05:                                   # head-on
        if rng.random() < 0.20:
            return set(ALL_PINS)
        if rng.random() < 0.35:
            return set(ALL_PINS) - rng.choice([{7, 10}, {4, 6}, {7, 9}, {4, 10}])
        return set(ALL_PINS) - set(rng.sample([2, 3, 4, 6, 7, 10], rng.choice([2, 3])))
    if err < 0.06:
        if rng.random() < 0.80 + 0.1 * speed:
            return set(ALL_PINS)
        return set(ALL_PINS) - rng.choice([{10 if hand > 0 else 7}, {7 if hand > 0 else 10}, {3, 6} if hand > 0 else {2, 4}])
    if err < 0.15:
        if rng.random() < 0.40:
            return set(ALL_PINS)
        back = [7, 8, 9, 10, 4, 6]
        return set(ALL_PINS) - set(rng.sample(back, rng.choice([2, 3, 4])))
    if err < 0.30:
        if rng.random() < 0.10:
            return set(ALL_PINS)
        if rng.random() < 0.25:                                # split
            return set(ALL_PINS) - rng.choice([{7, 10}, {4, 6}, {2, 7}, {3, 10}, {4, 7, 10}])
        knocked = set(rng.sample(sorted(ALL_PINS), rng.choice([4, 5, 6, 7])))
        return knocked
    # wide: clip the near side
    side = 1 if x_e > 0 else -1
    near = [p for p in ALL_PINS if PIN_X[p] * side > 0.1]
    return set(rng.sample(near, min(len(near), rng.choice([1, 2, 3, 4]))))


def partial_rack(x_e: float, speed: float, standing: set[int], rng: random.Random) -> set[int]:
    """Geometry model: pins the ball reaches fall; pins behind a fallen pin fall with a chain probability."""
    knocked: set[int] = set()
    for p in sorted(standing, key=lambda q: PIN_ROW[q]):
        dist = abs(x_e - PIN_X[p])
        p_hit = max(0.0, min(0.95, 1.0 - dist / (BALL_R + 0.08))) * (0.75 + 0.25 * speed)
        if rng.random() < p_hit:
            knocked.add(p)
    changed = True
    while changed:
        changed = False
        for p in list(knocked):
            for q in BEHIND[p]:
                if q in standing and q not in knocked and rng.random() < 0.55:
                    knocked.add(q); changed = True
    return knocked


class Frame:
    def __init__(self, n: int):
        self.n = n
        self.rolls: list[int] = []
        self.standing: set[int] = set(ALL_PINS)
        self.paths: list[list[tuple[float, float]]] = []
        self.outcome: str | None = None

    def add(self, knocked: set[int], path) -> None:
        self.rolls.append(len(knocked))
        self.standing -= knocked
        self.paths.append(path)
        if not self.standing:
            self.standing = set(ALL_PINS)  # re-rack (strike, or bonus balls in the last frame)

    def is_strike_first(self) -> bool:
        return bool(self.rolls) and self.rolls[0] == 10

    def is_spare(self) -> bool:
        return len(self.rolls) >= 2 and self.rolls[0] < 10 and self.rolls[0] + self.rolls[1] == 10


def score_frames(frames: list[Frame], n_frames: int) -> tuple[int, list[int | None]]:
    """Standard scoring generalized to n_frames; the last frame carries bonus balls like a 10th frame."""
    rolls: list[int] = []
    for f in frames:
        rolls.extend(f.rolls)
    total, i = 0, 0
    per: list[int | None] = []
    for fi in range(n_frames):
        if i >= len(rolls):
            per.append(None)
            continue
        last = fi == n_frames - 1
        if rolls[i] == 10 and not last:
            if i + 2 < len(rolls):
                total += 10 + rolls[i + 1] + rolls[i + 2]; per.append(total)
            else:
                per.append(None)
            i += 1
        elif i + 1 < len(rolls) and rolls[i] + rolls[i + 1] == 10 and not last:
            if i + 2 < len(rolls):
                total += 10 + rolls[i + 2]; per.append(total)
            else:
                per.append(None)
            i += 2
        elif last:
            total += sum(rolls[i:i + 3]); per.append(total)
            i = len(rolls)
        else:
            if i + 1 < len(rolls):
                total += rolls[i] + rolls[i + 1]; per.append(total)
            else:
                per.append(None)
            i += 2
    return total, per


def frame_complete(f: Frame, last: bool) -> bool:
    if not last:
        return f.is_strike_first() or len(f.rolls) >= 2
    if len(f.rolls) >= 3:
        return True
    if len(f.rolls) == 2:
        return not (f.rolls[0] == 10 or f.rolls[0] + f.rolls[1] == 10)
    return False


class BowlingMatch(Match):
    sport = "bowling"

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        g = self.config.get("game.bowling")
        self.n_frames = int(g["quick_frames"]) if self.quick else 10
        self.k_hook, self.gutter, self.pocket = float(g["k_hook"]), float(g["gutter"]), float(g["pocket"])
        self.roll_s = float(g["roll_animation_s"])
        self.human: list[Frame] = []
        self.house: list[Frame] = []
        self.policy = BowlerPolicy(self.tier.params)
        self.house_option: Option | None = None
        self.cur: Frame | None = None
        self.cur_ticks: list[dict[str, Any]] = []
        self.lane_drift = 0.0
        self.hand = 1
        self.extra_frames = 0
        self.last_human_frame_outcome = "open"

    # ---- turns: one turn = one human frame (1-3 balls in one input window) then the House frame -------------
    def plan_turn(self) -> TurnPlan | None:
        if len(self.human) >= self.n_frames + self.extra_frames:
            return None
        n = len(self.human) + 1
        self.cur = Frame(n)
        self.cur_ticks = []
        if self.tier.twist == "pin_king":
            self.lane_drift = self.rng.uniform(-0.3, 0.3)
        label = f"Frame {n}"
        return TurnPlan(label=label, input_seats=list(self.seats), input_window_s=float(self.config.get("game.bowling.input_window_s", 20)),
                        markets=[MarketSpec("turn_outcome", f"{label}: {self.players.get(self.seats[0], 'Player') if self.seats else 'Player'} rolls", [("strike", "Strike"), ("spare", "Spare"), ("open", "Open frame")])],
                        prompt={"ball": 1, "standing": sorted(self.cur.standing), "frame": n})

    def _is_last(self) -> bool:
        return self.cur is not None and self.cur.n >= self.n_frames + self.extra_frames

    def on_gesture(self, seat_id: str, gesture) -> bool:
        if self.cur is None or gesture.kind != "release" or seat_id not in self.seats:
            return False
        ex = gesture.extra
        spin = float(ex.get("spin_dps", 0.0))
        self.hand = 1 if spin >= 0 else -1
        self._roll(self.cur, float(ex.get("lane", 0.0)), float(ex.get("speed", gesture.power)), spin, self.hand, who="human")
        return True

    def _roll(self, frame: Frame, lane: float, speed: float, spin: float, hand: int, who: str) -> set[int]:
        path = ball_path(lane, speed, spin, hand, self.k_hook, self.lane_drift)
        x_e = path[-1][1]
        theta = math.atan2(path[-1][1] - path[-2][1], 1.0 / (len(path) - 1))
        standing_before = set(frame.standing)
        if any(abs(x) > self.gutter for _, x in path):
            knocked: set[int] = set()
            gutter = True
        else:
            gutter = False
            if len(standing_before) == 10:
                force = None
                if who == "human" and frame.n in self.scenario.get("strike_frames", []) and len(frame.rolls) == 0:
                    force = float(self.scenario.get("strike_pocket_err", 0.15))
                knocked = first_ball(x_e, theta, speed, hand, self.rng, self.pocket, force)
            else:
                knocked = partial_rack(x_e, speed, standing_before, self.rng)
        frame.add(knocked, path)
        outcome = "strike" if len(knocked) == 10 and len(frame.rolls) == 1 else ("spare" if frame.is_spare() and len(frame.rolls) == 2 else ("gutter" if gutter else "hit"))
        self.cur_ticks.append({"who": who, "frame": frame.n, "ball": len(frame.rolls), "path": [[round(d, 2), round(x, 3)] for d, x in path],
                               "pins_before": sorted(standing_before), "knocked": sorted(knocked), "pins_after": sorted(frame.standing if frame.standing != ALL_PINS or not knocked else set()),
                               "outcome": outcome, "speed": round(speed, 2), "spin": round(spin, 1), "lane": round(lane, 3), "lane_drift": round(self.lane_drift, 3),
                               "flags": {"shake": outcome == "strike", "hitstop": len(knocked) >= 6, "gutter": gutter}, "anim_s": self.roll_s})
        return knocked

    def input_done(self) -> bool:
        return self.cur is not None and frame_complete(self.cur, self._is_last())

    def next_prompt(self) -> dict[str, Any] | None:
        if self.cur is None or self.input_done():
            return None
        return {"ball": len(self.cur.rolls) + 1, "standing": sorted(self.cur.standing), "frame": self.cur.n, "rerack": self.cur.standing == ALL_PINS}

    def no_input(self) -> None:
        assert self.cur is not None
        while not frame_complete(self.cur, self._is_last()):
            self.cur.add(set(), [(0, 0), (1, 0)])
            self.cur_ticks.append({"who": "human", "frame": self.cur.n, "ball": len(self.cur.rolls), "path": [[0, 0], [1, 0]], "pins_before": sorted(self.cur.standing), "knocked": [], "pins_after": sorted(self.cur.standing), "outcome": "no_swing", "flags": {}, "anim_s": 0.8})

    def decisions_before(self, phase: str) -> list[DecisionRequest]:
        if phase != "resolving":
            return []
        state = {"human_score": self.score("human"), "house_score": self.score("house"), "frame": len(self.house) + 1, "last_human": self.cur.outcome if self.cur else None}
        opts = self.policy.options(state, self.rng)
        return [DecisionRequest(agent_id=f"house:bowling:{self.tier.id}", options=opts, default=self.policy.default(opts, self.rng), context=state, turn_no=self.turn_no, match_id=self.match_id)]

    def apply_decision(self, req: DecisionRequest, option: Option) -> None:
        self.house_option = option

    def resolve(self) -> TurnResult:
        assert self.cur is not None
        f = self.cur
        f.outcome = "strike" if f.is_strike_first() else ("spare" if f.is_spare() else "open")
        self.human.append(f)
        self.last_human_frame_outcome = f.outcome
        # House frame with the same rules
        hf = Frame(f.n)
        opt = self.house_option or self.policy.default(self.policy.options({}, self.rng), self.rng)
        hand = 1
        while not frame_complete(hf, hf.n >= self.n_frames + self.extra_frames):
            comp = self.lane_drift if self.tier.twist == "pin_king" else self.lane_drift * 0.5
            rp = BowlerPolicy.roll_params(opt, hand, self.rng, hf.standing if hf.standing != ALL_PINS or hf.rolls else None, drift=comp)
            self._roll(hf, rp["lane"], rp["speed"], rp["spin"], hand, who="house")
        hf.outcome = "strike" if hf.is_strike_first() else ("spare" if hf.is_spare() else "open")
        self.house.append(hf)
        triggers = []
        if f.outcome == "strike":
            triggers.append(("strike", {"player": self.players.get(self.seats[0], "Player") if self.seats else "Player"}))
        elif f.outcome == "spare":
            triggers.append(("turn_result", {"outcome": "Spare", "player": self.players.get(self.seats[0], "Player") if self.seats else "Player"}))
        else:
            triggers.append(("taunt", {"outcome": f.outcome}))
        anim = sum(t.get("anim_s", 2.0) for t in self.cur_ticks) + 0.6
        detail = {"human_frame": {"rolls": f.rolls, "outcome": f.outcome}, "house_frame": {"rolls": hf.rolls, "outcome": hf.outcome}, "house_option": opt.id}
        res = TurnResult(outcome=f.outcome, detail=detail, score=self.summary(), market_winners={"turn_outcome": [f.outcome]}, triggers=triggers, animation_s=anim, ticks=list(self.cur_ticks))
        self.cur = None
        return res

    def score(self, who: str) -> int:
        return score_frames(self.human if who == "human" else self.house, self.n_frames + self.extra_frames)[0]

    def summary(self) -> dict[str, Any]:
        ht, hp = score_frames(self.human, self.n_frames + self.extra_frames)
        xt, xp = score_frames(self.house, self.n_frames + self.extra_frames)
        return {"n_frames": self.n_frames + self.extra_frames, "human": {"total": ht, "frames": [f.rolls for f in self.human], "per": hp},
                "house": {"total": xt, "frames": [f.rolls for f in self.house], "per": xp}, "lane_drift": round(self.lane_drift, 3)}

    def winner(self) -> str:
        h, x = self.score("human"), self.score("house")
        return "human" if h > x else ("house" if x > h else "tie")

    def grant_extra_frame(self) -> None:
        self.extra_frames += 1
