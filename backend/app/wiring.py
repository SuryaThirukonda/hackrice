"""Composition root: builds the arena loop and wires every module onto it. Used by main.py, tests, and headless scripts."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .arena import ArenaLoop
from .clock import Clock
from .config import Config
from .rooms import Rooms
from .state import ArenaState


@dataclass
class Arena:
    config: Config
    loop: ArenaLoop
    state: ArenaState
    rooms: Rooms
    store: Any = None
    modules: dict[str, Any] = None  # type: ignore[assignment]

    def step(self, now: float | None = None):
        return self.loop.step(now)


def build_arena(config: Config | None = None, clock: Clock | None = None, store=None, seat_mode: str = "single") -> Arena:
    config = config or Config.load()
    loop = ArenaLoop(config, clock=clock, store=store)
    state = ArenaState(public_url=config.public_url)
    rooms = Rooms(loop, state, config)
    arena = Arena(config=config, loop=loop, state=state, rooms=rooms, store=store, modules={})
    rooms.configure_seats(seat_mode)
    _wire_optional_modules(arena)
    loop.flush_events()  # discard boot-time seat.update (no connections yet)
    return arena


def _wire_optional_modules(arena: Arena) -> None:
    """Later milestones register here: motion, market, games, agents, voice, host."""
    for name in ("motion.worker", "market.wiring", "games.wiring", "agents.wiring", "voice.wiring", "market.sponsor", "market.card", "market.pairing", "host"):
        try:
            mod = __import__(f"app.{name}", fromlist=["install"])
        except ImportError:
            continue
        install = getattr(mod, "install", None)
        if install:
            arena.modules[name] = install(arena)
