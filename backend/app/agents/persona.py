"""Persona layer: an LLM picks among engine-approved options in character and writes one short line.
Never blocks play: timeouts, invalid ids, refusals and errors fall back to the engine default."""
from __future__ import annotations

import asyncio
import json
import random
import time
from typing import Any, Protocol

from pydantic import BaseModel, Field

from .policy import DecisionRequest, Option, TierConfig

RULES = ("You are playing an arcade sports opponent in a live show. Reply with JSON only. Pick exactly one option_id from the list. "
         "Write one short spoken line (max 90 characters) in character, PG-13, playful trash talk, no slurs, no real people. "
         "You may reference the memory of past matches against this player.")


class PersonaChoice(BaseModel):
    option_id: str
    line: str = Field(max_length=200)


class PersonaBackend(Protocol):
    async def choose(self, req: DecisionRequest, tier: TierConfig, memory: dict[str, Any]) -> PersonaChoice | None: ...


class OfflinePersona:
    """No network: engine default plus a taunt from the tier's bank after a small simulated latency."""

    def __init__(self, rng: random.Random | None = None, delay_range: tuple[float, float] = (0.0, 0.2)):
        self.rng = rng or random.Random()
        self.delay_range = delay_range

    async def choose(self, req: DecisionRequest, tier: TierConfig, memory: dict[str, Any]) -> PersonaChoice | None:
        await asyncio.sleep(self.rng.uniform(*self.delay_range))
        line = self.rng.choice(tier.taunts) if tier.taunts else ""
        last = memory.get("last_line")
        if len(tier.taunts) > 1 and line == last:
            line = self.rng.choice([t for t in tier.taunts if t != last])
        return PersonaChoice(option_id=req.default.id, line=line)


class OpenAIPersona:
    def __init__(self, api_key: str, model: str = "gpt-5-mini", timeout_s: float = 1.5):
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(api_key=api_key)
        self.model, self.timeout_s = model, timeout_s
        self.calls = 0
        self.failures = 0

    async def choose(self, req: DecisionRequest, tier: TierConfig, memory: dict[str, Any]) -> PersonaChoice | None:
        self.calls += 1
        payload = {"state": req.context, "options": [o.public() for o in req.options], "memory": memory, "taunt_bank": tier.taunts[:6]}
        system = f"{tier.persona_prompt}\n\n{RULES}"
        try:
            resp = await asyncio.wait_for(self.client.responses.parse(
                model=self.model,
                input=[{"role": "system", "content": system}, {"role": "user", "content": json.dumps(payload)}],
                text_format=PersonaChoice,
                max_output_tokens=200,
            ), timeout=self.timeout_s)
            parsed = getattr(resp, "output_parsed", None)
            if parsed is None:
                self.failures += 1
            return parsed
        except Exception:  # noqa: BLE001  (timeout, API error, refusal, bad JSON: all fall back to the default)
            self.failures += 1
            return None


class PersonaMemory:
    def __init__(self, cap: int = 5):
        self.cap = cap
        self.data: dict[tuple[str, str], dict[str, Any]] = {}

    def get(self, agent_id: str, nickname: str) -> dict[str, Any]:
        return self.data.setdefault((agent_id, nickname), {"results": [], "moment": None, "last_line": None})

    def remember_line(self, agent_id: str, nickname: str, line: str | None) -> None:
        if line:
            self.get(agent_id, nickname)["last_line"] = line

    def remember_result(self, agent_id: str, nickname: str, result: str, moment: str | None = None) -> None:
        m = self.get(agent_id, nickname)
        m["results"] = (m["results"] + [result])[-self.cap:]
        if moment:
            m["moment"] = moment


class PersonaProvider:
    """games.decision_provider: runs the backend as a task and posts the result back as an intent."""

    def __init__(self, arena, backend: PersonaBackend, tiers_by_agent, memory: PersonaMemory | None = None):
        self.arena, self.backend, self.tiers_by_agent = arena, backend, tiers_by_agent
        self.memory = memory or PersonaMemory()
        self.loop = arena.loop
        self.loop.on("persona.result", self.on_result)
        self._cbs: dict[str, Any] = {}
        self._n = 0

    def provide(self, req: DecisionRequest, cb) -> None:
        tier = self.tiers_by_agent(req.agent_id)
        nickname = self._nickname()
        mem = self.memory.get(req.agent_id, nickname)
        self._n += 1
        key = f"p{self._n}"
        self._cbs[key] = (req, cb, time.perf_counter(), nickname)
        try:
            aloop = asyncio.get_running_loop()
        except RuntimeError:
            aloop = None
        if aloop is None:
            cb(req.default, "default", None, 0.0)
            self._cbs.pop(key, None)
            return
        async def job():
            choice = await self.backend.choose(req, tier, dict(mem))
            self.loop.submit(Intent("persona.result", {"key": key, "choice": choice.model_dump() if choice else None}))
        aloop.create_task(job())

    def on_result(self, i) -> None:
        key = i.d.get("key")
        entry = self._cbs.pop(key, None)
        if not entry:
            return
        req, cb, t0, nickname = entry
        latency = (time.perf_counter() - t0) * 1000
        choice = i.d.get("choice")
        valid = {o.id: o for o in req.options}
        if choice and choice.get("option_id") in valid:
            line = (choice.get("line") or "").strip() or None
            self.memory.remember_line(req.agent_id, nickname, line)
            cb(valid[choice["option_id"]], "persona", line, latency)
        else:
            cb(req.default, "default", None, latency)

    def _nickname(self) -> str:
        m = self.arena.state.match or {}
        players = m.get("players") or {}
        return next(iter(players.values()), "room")


from ..arena import Intent  # noqa: E402  (bottom import to avoid a cycle at module load)
