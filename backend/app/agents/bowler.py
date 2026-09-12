"""House bowler: draws (lane, speed, spin) from the tier's distributions; options bias the draw (persona picks)."""
from __future__ import annotations

import random
from typing import Any

from .policy import Option, noisy_pick


class BowlerPolicy:
    def __init__(self, params: dict[str, Any]):
        self.p = dict(params)

    def options(self, state: dict[str, Any], rng: random.Random) -> list[Option]:
        p = self.p
        behind = state.get("house_score", 0) < state.get("human_score", 0)
        base = {"speed_mean": p["speed_mean"], "speed_sigma": p["speed_sigma"], "spin_mean": p["spin_mean"], "spin_sigma": p["spin_sigma"], "lane_sigma": p["lane_sigma"]}
        pocket = Option("pocket", "Play the pocket", dict(base), ev=0.55)
        straight = Option("straight", "Roll it straight", {**base, "spin_mean": p["spin_mean"] * 0.3, "spin_sigma": p["spin_sigma"] * 0.6, "lane_sigma": p["lane_sigma"] * 0.8, "speed_mean": min(1.0, p["speed_mean"] + 0.05)}, ev=0.45)
        hook = Option("hook_hard", "Big hook", {**base, "spin_mean": p["spin_mean"] * 1.5 + 60, "spin_sigma": p["spin_sigma"] * 1.3, "lane_sigma": p["lane_sigma"] * 1.4}, ev=0.5 if behind else 0.35)
        return [pocket, straight, hook]

    def default(self, options: list[Option], rng: random.Random) -> Option:
        return noisy_pick(options, rng, temperature=0.1)

    @staticmethod
    def roll_params(option: Option, hand: int, rng: random.Random, standing: set[int] | None = None, drift: float = 0.0) -> dict[str, float]:
        """Sample a concrete roll. For a partial rack, aim at the centroid of the standing pins. `drift` is the oil drift the
        House compensates for (the Pin King knows the pattern it set; other tiers only half-read it)."""
        p = option.params
        from ..games.bowling import PIN_X
        if standing and len(standing) < 10:
            target = sum(PIN_X[i] for i in standing) / len(standing)
            spin = rng.gauss(p["spin_mean"] * 0.4, p["spin_sigma"] * 0.5)
        else:
            target = hand * 0.29  # the 1-3 pocket (or 1-2 for a lefty)
            spin = rng.gauss(p["spin_mean"], p["spin_sigma"])
        speed = max(0.05, min(1.0, rng.gauss(p["speed_mean"], p["speed_sigma"])))
        spin_norm = max(-1.0, min(1.0, spin / 400.0))
        # aim so that the hook lands on the target: x(1) = lane - hand*k*spin_norm*(1-0.5*speed)  ->  lane = target + hook
        hook = hand * 0.8 * spin_norm * (1 - 0.5 * speed)
        lane = max(-0.9, min(0.9, rng.gauss(target + hook - drift, p["lane_sigma"])))
        return {"lane": lane, "speed": speed, "spin": spin, "hand": hand}
