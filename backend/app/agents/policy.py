"""Opponent policy interfaces: deterministic engines produce ranked legal options; a persona (later) picks among them."""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class Option:
    id: str
    label: str
    params: dict[str, Any] = field(default_factory=dict)
    ev: float = 0.0

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "label": self.label, "ev": round(self.ev, 3)}


@dataclass
class DecisionRequest:
    agent_id: str          # e.g. "house:bowling:rookie"
    options: list[Option]
    default: Option
    context: dict[str, Any]   # compact state summary for the persona prompt
    turn_no: int
    match_id: str


class Policy(Protocol):
    def options(self, state: dict[str, Any], rng: random.Random) -> list[Option]: ...
    def default(self, options: list[Option], rng: random.Random) -> Option: ...


@dataclass
class TierConfig:
    id: str
    name: str
    sport: str
    params: dict[str, Any]
    voice_id: str = ""
    persona_prompt: str = ""
    taunts: list[str] = field(default_factory=list)
    accent: str = "#2ba1e8"
    signature: str = ""
    twist: str | None = None

    @classmethod
    def from_dict(cls, sport: str, d: dict[str, Any]) -> "TierConfig":
        return cls(id=d["id"], name=d["name"], sport=sport, params=dict(d.get("params", {})), voice_id=d.get("voice_id", ""),
                   persona_prompt=d.get("persona_prompt", ""), taunts=list(d.get("taunts", [])), accent=d.get("accent", "#2ba1e8"),
                   signature=d.get("signature", ""), twist=d.get("twist"))

    def public(self) -> dict[str, Any]:
        return {"tier": self.id, "name": self.name, "accent": self.accent, "signature": self.signature, "twist": self.twist, "sport": self.sport}


def noisy_pick(options: list[Option], rng: random.Random, temperature: float = 0.15) -> Option:
    """Top-EV option most of the time; a lower one with small probability so the House is not a metronome."""
    ranked = sorted(options, key=lambda o: -o.ev)
    for o in ranked:
        if rng.random() > temperature:
            return o
    return ranked[-1]
