import asyncio

import pytest

from app.agents.persona import OfflinePersona, PersonaChoice, PersonaMemory, PersonaProvider
from app.agents.policy import DecisionRequest, Option, TierConfig
from app.clock import FakeClock
from app.config import Config
from app.wiring import build_arena


class FakePersona:
    def __init__(self, mode):
        self.mode = mode

    async def choose(self, req, tier, memory):
        if self.mode == "slow":
            await asyncio.sleep(0.3)
            return PersonaChoice(option_id="straight", line="too late")
        if self.mode == "invalid":
            return PersonaChoice(option_id="nope", line="x")
        if self.mode == "raise":
            raise RuntimeError("boom")
        if self.mode == "refuse":
            return None
        if self.mode == "good":
            return PersonaChoice(option_id="hook_hard", line="Watch the hook, " + str(memory.get("results")))
        return None


def req():
    opts = [Option("pocket", "P", ev=0.5), Option("straight", "S", ev=0.4), Option("hook_hard", "H", ev=0.3)]
    return DecisionRequest("house:bowling:rookie", opts, opts[0], {"frame": 1}, 1, "m1")


def tier():
    cfg = Config.load()
    return TierConfig.from_dict("bowling", cfg.tier("bowling", "rookie"))


@pytest.mark.parametrize("mode,expect_source,expect_option", [("slow", "default", "pocket"), ("invalid", "default", "pocket"), ("raise", "default", "pocket"), ("refuse", "default", "pocket"), ("good", "persona", "hook_hard")])
@pytest.mark.asyncio
async def test_provider_never_blocks_the_turn(mode, expect_source, expect_option):
    cfg = Config.load()
    arena = build_arena(cfg, clock=FakeClock(), store=None)
    backend = FakePersona(mode)

    class Wrapped:   # 0.15 s deadline like the real provider's timeout, applied here for the fake
        async def choose(self, r, t, m):
            try:
                return await asyncio.wait_for(backend.choose(r, t, m), 0.15)
            except Exception:  # noqa: BLE001
                return None
    prov = PersonaProvider(arena, Wrapped(), lambda a: tier(), PersonaMemory())
    got = {}
    prov.provide(req(), lambda opt, src, line, lat: got.update(opt=opt.id, src=src, line=line, lat=lat))
    for _ in range(50):
        await asyncio.sleep(0.01)
        arena.step()
        if got:
            break
    assert got["src"] == expect_source and got["opt"] == expect_option
    if mode == "good":
        assert "Watch the hook" in got["line"]


def test_provider_without_event_loop_uses_default():
    arena = build_arena(Config.load(), clock=FakeClock(), store=None)
    prov = PersonaProvider(arena, FakePersona("good"), lambda a: tier(), PersonaMemory())
    got = {}
    prov.provide(req(), lambda opt, src, line, lat: got.update(opt=opt.id, src=src))
    assert got == {"opt": "pocket", "src": "default"}


@pytest.mark.asyncio
async def test_offline_persona_rotates_taunts_and_memory():
    p = OfflinePersona(delay_range=(0, 0))
    t = tier()
    mem = PersonaMemory()
    m = mem.get("a", "Judge")
    lines = set()
    for _ in range(12):
        c = await p.choose(req(), t, m)
        assert c.option_id == "pocket" and c.line in t.taunts
        mem.remember_line("a", "Judge", c.line)
        lines.add(c.line)
    assert len(lines) > 1
    mem.remember_result("a", "Judge", "lost")
    assert mem.get("a", "Judge")["results"] == ["lost"]


def test_headless_match_gets_taunts_and_default_decisions(arena, make_client, clock):
    from scripts.headless_sim import FakeSeat, play_match, PROFILES
    import random
    proj = make_client("projector")
    seat = FakeSeat(arena)
    play_match(arena, clock, seat, "bowling", "rookie", PROFILES["bowling"], random.Random(1), seed=3)
    decisions = proj.of("agent.decision")
    assert decisions and all(d.d["source"] == "default" for d in decisions)       # FakeClock, no asyncio loop
    lines = proj.of("voice.line")
    assert lines and all(l.d["url"] is None for l in lines) and any(l.d["trigger"] == "match_start" for l in lines)
