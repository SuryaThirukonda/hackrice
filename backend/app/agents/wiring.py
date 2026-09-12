"""Agents module: adaptive difficulty + persona provider (OpenAI when a key is present, offline otherwise)."""
from __future__ import annotations

import logging
import random

from ..agents.policy import TierConfig
from .adaptive import AdaptiveController
from .persona import OfflinePersona, OpenAIPersona, PersonaMemory, PersonaProvider

log = logging.getLogger("hap.agents")


class AgentsModule:
    def __init__(self, arena, backend=None):
        self.arena = arena
        self.config = arena.config
        self.adaptive = AdaptiveController(arena)
        self.memory = PersonaMemory()
        pc = self.config.get("tiers.persona", {})
        if backend is not None:
            self.backend = backend
        elif self.config.persona_enabled:
            self.backend = OpenAIPersona(self.config.openai_key, str(pc.get("model", "gpt-5-mini")), float(pc.get("timeout_s", 1.5)))
            log.info("persona: OpenAI %s", pc.get("model"))
        else:
            self.backend = OfflinePersona(random.Random())
            log.info("persona: offline taunt bank")
        self.provider = PersonaProvider(arena, self.backend, self.tier_for_agent, self.memory)
        games = arena.modules.get("games.wiring")
        if games:
            games.decision_provider = self.provider.provide
            games.on_match_end.append(self.on_match_end)

    def tier_for_agent(self, agent_id: str) -> TierConfig:
        parts = agent_id.split(":")        # house:<sport>:<tier>[:<fighter>]
        sport, tier_id = parts[1], parts[2]
        return TierConfig.from_dict(sport, self.config.tier(sport, tier_id))

    def on_match_end(self, match, winner: str) -> None:
        for nick in match.players.values():
            self.memory.remember_result(f"house:{match.sport}:{match.tier.id}", nick, "lost" if winner == "human" else "won",
                                        moment=f"{match.sport} match ended {winner}")


def install(arena) -> AgentsModule:
    return AgentsModule(arena)
