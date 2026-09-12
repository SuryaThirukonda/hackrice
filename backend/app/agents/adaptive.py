"""Adaptive difficulty: nudge one House parameter per sport toward a target human success rate, with caps.
Telegraphed to spectators as the 'House is studying you' meter."""
from __future__ import annotations

from typing import Any


class AdaptiveController:
    def __init__(self, arena, target: float = 0.5, k: float = 0.3, alpha: float = 0.35):
        self.arena = arena
        self.config = arena.config
        self.target, self.k, self.alpha = target, k, alpha
        self.state: dict[str, dict[str, Any]] = {}   # match_id -> {ema, nudge, param, ...}
        games = arena.modules.get("games.wiring")
        if games:
            games.on_turn_result.append(self.on_turn_result)
            games.on_match_start.append(self.on_match_start)

    def spec(self, sport: str) -> dict[str, Any] | None:
        return self.config.get(f"tiers.{sport}.adaptive")

    def on_match_start(self, match) -> None:
        if match.seats:   # humans only; the card is never nudged
            self.state[match.match_id] = {"ema": self.target, "nudge": 0.0, "n": 0}

    @staticmethod
    def success(match, res) -> float | None:
        if match.sport == "bowling":
            return 1.0 if res.outcome in ("strike", "spare") else 0.0
        if match.sport == "baseball":
            return 1.0 if res.outcome == "hit" else 0.0
        if match.sport == "boxing":
            d = res.detail
            a, b = d.get("a", {}), d.get("b", {})
            tot = a.get("dealt_round", 0) + b.get("dealt_round", 0)
            return (a.get("dealt_round", 0) / tot) if tot else None
        return None

    def on_turn_result(self, match, res) -> None:
        st = self.state.get(match.match_id)
        sp = self.spec(match.sport)
        if st is None or sp is None or getattr(match, "sponsored_turn", False):
            return
        s = self.success(match, res)
        if s is None:
            return
        st["n"] += 1
        st["ema"] = st["ema"] + self.alpha * (s - st["ema"])
        err = st["ema"] - self.target                       # > 0: human winning too much -> make the House stronger
        param, lo, hi = sp["param"], float(sp["min"]), float(sp["max"])
        weaker = float(sp.get("weaker", 1))
        base = float(match.tier.params.get(param, 0.0))
        span = hi - lo
        delta = -self.k * err * span * weaker               # human losing (err<0) -> push toward "weaker" direction
        new_nudge = st["nudge"] + delta
        new_val = min(hi, max(lo, base + new_nudge))
        st["nudge"] = new_val - base
        match.adjustments[param] = st["nudge"]
        self.apply(match, param, st["nudge"])
        level = min(1.0, abs(st["nudge"]) / max(1e-9, span * 0.5))
        self.arena.state.studying[f"house:{match.sport}"] = {"agent_id": f"house:{match.sport}:{match.tier.id}", "level": round(level, 3), "param": param, "delta": round(st["nudge"], 4), "ema": round(st["ema"], 3), "n": st["n"]}
        self.arena.loop.emit("agent.studying", self.arena.state.studying[f"house:{match.sport}"], to="all")

    @staticmethod
    def apply(match, param: str, nudge: float) -> None:
        """Push the adjustment into the live policy objects that read tier params directly."""
        if match.sport == "bowling":
            match.policy.p[param] = float(match.tier.params.get(param, 0.0)) + nudge
        elif match.sport == "boxing" and getattr(match, "b", None) is not None and match.b.house:
            match.b.house.adjust[param] = nudge
        # baseball reads W_ms through match.param() already


def install(arena):
    return AdaptiveController(arena)
