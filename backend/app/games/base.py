"""Common match framework: turns with betting -> input -> resolving -> between phases; engines subclass Match."""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any

from ..agents.policy import DecisionRequest, Option, TierConfig


@dataclass
class MarketSpec:
    kind: str
    label: str
    outcomes: list[tuple[str, str]]
    seed_stake: dict[str, int] | None = None


@dataclass
class TurnPlan:
    label: str
    input_seats: list[str]              # seats that must act this turn ([] = House-only turn)
    input_window_s: float
    markets: list[MarketSpec] = field(default_factory=list)
    betting: bool = True                 # open a betting window before input?
    prompt: dict[str, Any] = field(default_factory=dict)


@dataclass
class TurnResult:
    outcome: str
    detail: dict[str, Any]
    score: dict[str, Any]
    market_winners: dict[str, list[str]]     # market kind -> winning outcome ids
    triggers: list[tuple[str, dict[str, Any]]] = field(default_factory=list)   # voice/sfx triggers
    animation_s: float = 2.0
    ticks: list[dict[str, Any]] = field(default_factory=list)                 # render summaries to emit in order


class Match:
    sport: str = "generic"
    quick: bool = True

    def __init__(self, match_id: str, seed: int, tier: TierConfig, seats: list[str], players: dict[str, str], config, scenario: dict[str, Any] | None = None):
        self.match_id, self.seed, self.tier, self.seats, self.players, self.config = match_id, seed, tier, seats, players, config
        self.rng = random.Random(seed)
        self.scenario = scenario or {}
        self.turn_no = 0
        self.phase = "created"
        self.ended = False
        self.pending_decisions: list[DecisionRequest] = []
        self.adjustments: dict[str, float] = {}   # adaptive difficulty / sponsor moves patch params here
        self.sponsored_turn = False

    # ---- to implement per sport ------------------------------------------------
    def plan_turn(self) -> TurnPlan | None:
        raise NotImplementedError

    def on_gesture(self, seat_id: str, gesture) -> bool:
        """Return True if the gesture was consumed as this turn's input."""
        raise NotImplementedError

    def input_done(self) -> bool:
        raise NotImplementedError

    def next_prompt(self) -> dict[str, Any] | None:
        """After a consumed gesture that does not finish the input, a new sub-window prompt (e.g. ball 2)."""
        return None

    def no_input(self) -> None:
        """Input window expired without the required input."""
        raise NotImplementedError

    def decisions_before(self, phase: str) -> list[DecisionRequest]:
        """House decisions needed before entering `phase` ('input' or 'resolving')."""
        return []

    def apply_decision(self, req: DecisionRequest, option: Option) -> None:
        pass

    def resolve(self) -> TurnResult:
        raise NotImplementedError

    def summary(self) -> dict[str, Any]:
        """Public match state for snapshots (score, frame, etc.)."""
        return {}

    def winner(self) -> str:
        raise NotImplementedError

    def match_winner_market(self) -> MarketSpec:
        human = ", ".join(self.players.values()) or "Player"
        return MarketSpec("match_winner", f"Match winner: {human} vs {self.tier.name}", [("human", human), ("house", self.tier.name)])

    def tick_now(self) -> dict[str, Any] | None:
        """Optional periodic render summary (boxing)."""
        return None

    # ---- helpers ------------------------------------------------------------------------------
    def param(self, name: str, default: float = 0.0) -> float:
        base = float(self.tier.params.get(name, default))
        return base + float(self.adjustments.get(name, 0.0))

    def public(self) -> dict[str, Any]:
        return {"match_id": self.match_id, "sport": self.sport, "seed": self.seed, "human_seats": self.seats, "players": self.players,
                "opponent": self.tier.public(), "turn_no": self.turn_no, "phase": self.phase, "score": self.summary(), "scenario": bool(self.scenario)}
