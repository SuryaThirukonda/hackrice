"""House boxer: tier parameters plus the small amount of per-fighter memory the engine's AI needs
(reaction timer, counter flag, punch pattern cursor). The physics and state machine live in games/boxing.py and are shared
with the human fighter. Persona options are round strategies that scale the parameters."""
from __future__ import annotations

import random
from typing import Any

from .policy import Option, noisy_pick


class BoxerPolicy:
    def __init__(self, params: dict[str, Any]):
        self.p = dict(params)

    def options(self, state: dict[str, Any], rng: random.Random) -> list[Option]:
        behind = state.get("my_hp", 100) < state.get("their_hp", 100)
        return [
            Option("press", "Press forward", {"aggression": 1.3, "block_p": 0.8, "hook_bias": 0.2, "retreat_mult": 0.3}, ev=0.55 if behind else 0.45),
            Option("counter", "Wait and counter", {"aggression": 0.6, "block_p": 1.6, "dodge_p": 1.4, "hook_bias": 0.0, "retreat_mult": 1.5}, ev=0.5),
            Option("wild", "Go wild with hooks", {"aggression": 1.5, "block_p": 0.5, "hook_bias": 0.6, "telegraph_mult": 1.2, "retreat_mult": 0.2}, ev=0.4 if not behind else 0.5),
        ]

    def default(self, options: list[Option], rng: random.Random) -> Option:
        return noisy_pick(options, rng, temperature=0.15)


class HouseBoxer:
    """Parameters and memory for one House-controlled fighter.

    Tier params: aggression (attacks/s at range), telegraph_ms (House windup: hooks use it fully, jabs 70%), reaction_ms (time from
    seeing the opponent's windup to acting), pattern, dodge_p, block_p, parry_p (boss tiers), speed (footwork multiplier),
    range (preferred distance), retreat_p (per-second chance to step back after a flurry), counter (counter-punch after a block),
    punish_p (chance to jab into the opponent's recovery/stagger window, when they cannot guard).
    """

    def __init__(self, params: dict[str, Any], rng: random.Random, fighter_id: str = "house"):
        self.base = dict(params)
        self.rng = rng
        self.id = fighter_id
        self.mods: dict[str, float] = {}
        self.pattern = list(params.get("pattern", ["jab", "jab", "hook"]))
        self.pi = 0
        self.guard_until = 0.0
        self.dodge_until = 0.0
        self.counter_pending = False
        self.adjust: dict[str, float] = {}
        self.seen_action = -1            # opponent action_id already reacted to
        self.punished_action = -1        # opponent action_id already considered for a punish
        self.react_at: float | None = None
        self.react_kind: str | None = None

    def set_option(self, option: Option | None) -> None:
        self.mods = dict(option.params) if option else {}

    def param(self, k: str, default: float = 0.0) -> float:
        v = float(self.base.get(k, default)) + float(self.adjust.get(k, 0.0))
        if k in ("aggression", "block_p", "dodge_p"):
            v *= float(self.mods.get(k, 1.0))
        if k == "telegraph_ms":
            v *= float(self.mods.get("telegraph_mult", 1.0))
        if k == "retreat_p":
            v *= float(self.mods.get("retreat_mult", 1.0))
        return v

    def next_punch(self) -> str:
        kind = self.pattern[self.pi % len(self.pattern)]
        self.pi += 1
        if self.rng.random() < float(self.mods.get("hook_bias", 0.0)):
            kind = "hook"
        return kind

    def wants_to_attack(self, dt_s: float, t: float) -> bool:
        if t < self.guard_until or t < self.dodge_until:
            return False
        return self.rng.random() < self.param("aggression", 0.5) * dt_s

    def wants_guard(self, t: float) -> float:
        """After recovering, sometimes hold guard for a while. Returns guard duration in s (0 = none)."""
        if self.rng.random() < self.param("block_p", 0.3) * 0.5:
            return self.rng.uniform(0.4, 0.9)
        return 0.0

    def reacts_to_punch(self, time_to_hit_ms: float) -> str | None:
        """The opponent started a windup that lands in time_to_hit_ms: can the House answer in time, and how?
        Returns 'parry', 'dodge', 'block' or None (too slow or chose not to)."""
        react = self.param("reaction_ms", 400)
        if react > time_to_hit_ms:
            return None
        r = self.rng.random()
        pp, dp, bp = self.param("parry_p", 0.0), self.param("dodge_p", 0.1), self.param("block_p", 0.3)
        if r < pp:
            return "parry"
        if r < pp + dp:
            return "dodge"
        if r < pp + dp + bp:
            return "block"
        return None
