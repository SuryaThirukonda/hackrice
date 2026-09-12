"""House pitcher: reads the batter's timing and swing rate, biases pitch selection toward what they handle worst."""
from __future__ import annotations

import random
from collections import deque
from typing import Any

from .policy import Option, noisy_pick

OFFSPEED = ("changeup", "curve", "knuckle")
LOCATION = ("high", "low", "inside", "outside")


class PitcherPolicy:
    def __init__(self, params: dict[str, Any]):
        self.p = dict(params)
        self.allowed = list(params.get("pitches", ["fastball", "changeup", "curve"]))
        self.dts: deque[float] = deque(maxlen=6)
        self.pitches_seen = 0
        self.swings = 0
        self.mode = "mix"

    def observe(self, dt_ms: float | None) -> None:
        self.pitches_seen += 1
        if dt_ms is not None:
            self.swings += 1
            self.dts.append(dt_ms)

    @property
    def swing_rate(self) -> float:
        return self.swings / self.pitches_seen if self.pitches_seen else 1.0

    @property
    def mean_dt(self) -> float | None:
        return sum(self.dts) / len(self.dts) if self.dts else None

    def options(self, state: dict[str, Any], rng: random.Random) -> list[Option]:
        return [
            Option("attack", "Attack with fastballs", {"mode": "attack"}, ev=0.45),
            Option("paint", "Paint the corners", {"mode": "paint"}, ev=0.5 if self.swing_rate < 0.6 else 0.4),
            Option("deceive", "Change speeds", {"mode": "deceive"}, ev=0.55 if (self.mean_dt is not None and abs(self.mean_dt) > 25) else 0.42),
        ]

    def default(self, options: list[Option], rng: random.Random) -> Option:
        return noisy_pick(options, rng, temperature=0.15)

    def choose_pitch(self, rng: random.Random) -> str:
        """The pitch for the next delivery. read_strength = how often the read (rather than the mix) decides."""
        read = float(self.p.get("read_strength", 0.5))
        md = self.mean_dt
        if rng.random() < read and len(self.dts) >= 2 and md is not None:
            if md < -30:     # swinging early: throw slow
                cands = [p for p in self.allowed if p in OFFSPEED] or self.allowed
                return rng.choice(cands)
            if md > 30:      # late: bring the heat
                cands = [p for p in self.allowed if p == "fastball"] or self.allowed
                return rng.choice(cands)
        if rng.random() < read and self.pitches_seen >= 3 and self.swing_rate < 0.5:
            cands = [p for p in self.allowed if p in LOCATION] or self.allowed
            return rng.choice(cands)
        weights = {p: 1.0 for p in self.allowed}
        if self.mode == "attack":
            weights = {p: (3.0 if p == "fastball" else 0.6) for p in self.allowed}
        elif self.mode == "paint":
            weights = {p: (2.5 if p in LOCATION else 0.8) for p in self.allowed}
        elif self.mode == "deceive":
            weights = {p: (2.5 if p in OFFSPEED else 0.8) for p in self.allowed}
        total = sum(weights.values())
        r = rng.random() * total
        for p, w in weights.items():
            r -= w
            if r <= 0:
                return p
        return self.allowed[-1]
