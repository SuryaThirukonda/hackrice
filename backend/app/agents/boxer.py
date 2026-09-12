"""House boxer: a state machine (idle, telegraph, strike, recover, block, dodge, down) with tier parameters.
Persona options are round strategies that scale the parameters."""
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
            Option("press", "Press forward", {"aggression": 1.3, "block_p": 0.8, "hook_bias": 0.2}, ev=0.55 if behind else 0.45),
            Option("counter", "Wait and counter", {"aggression": 0.6, "block_p": 1.6, "dodge_p": 1.4, "hook_bias": 0.0}, ev=0.5),
            Option("wild", "Go wild with hooks", {"aggression": 1.5, "block_p": 0.5, "hook_bias": 0.6, "telegraph_mult": 1.2}, ev=0.4 if not behind else 0.5),
        ]

    def default(self, options: list[Option], rng: random.Random) -> Option:
        return noisy_pick(options, rng, temperature=0.15)


class HouseBoxer:
    """Runtime state machine for one House-controlled fighter."""

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

    def set_option(self, option: Option | None) -> None:
        self.mods = dict(option.params) if option else {}

    def param(self, k: str, default: float = 0.0) -> float:
        v = float(self.base.get(k, default)) + float(self.adjust.get(k, 0.0))
        if k in ("aggression", "block_p", "dodge_p"):
            v *= float(self.mods.get(k, 1.0))
        if k == "telegraph_ms":
            v *= float(self.mods.get("telegraph_mult", 1.0))
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

    def reacts_to_punch(self, punch_duration_ms: float) -> str | None:
        """When a human punch arrives: can the House block or dodge it in time? Returns 'block', 'dodge' or None."""
        react = self.param("reaction_ms", 400)
        if react > punch_duration_ms + 120:
            return None
        r = self.rng.random()
        if r < self.param("dodge_p", 0.1):
            return "dodge"
        if r < self.param("dodge_p", 0.1) + self.param("block_p", 0.3):
            return "block"
        return None
