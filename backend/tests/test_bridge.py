"""The game-client contract (Phaser speaks it in production), exercised with PythonGameClient standing in (HAP_ENGINE=client)."""
import random

import pytest

from app.clock import FakeClock
from app.config import Config
from app.games.gameclient import PythonGameClient
from app.wiring import build_arena
from tests.conftest import Client


@pytest.fixture
def garena():
    cfg = Config.load()
    cfg.engine = "client"
    return build_arena(cfg, clock=FakeClock(), store=None)


class FakeGameClient:
    """In-process game client: a conftest Client of role=game wired to a PythonGameClient."""

    def __init__(self, arena):
        self.arena = arena
        self.client = Client(arena, "game", device_id="client-test")
        self.gc = PythonGameClient(arena.config, self._send, lambda: arena.loop.clock.now_ms())
        self.client.send("game.hello", {"engine": "test"}); arena.step(); self.pump()

    def _send(self, t, d):
        self.client.send(t, d)

    def pump(self):
        for env in self.client.pump():
            if env.t.startswith("game."):
                self.gc.handle(env.t, env.d)

    def run(self, seconds, dt=0.1, on_input=None):
        clock = self.arena.loop.clock
        for _ in range(int(seconds / dt)):
            clock.advance(dt)
            self.arena.step(); self.pump()
            self.gc.step(); self.arena.step(); self.pump()
            if on_input and self.gc.input_deadline_ms is not None:
                on_input(self)
                self.arena.step(); self.pump()


def test_bridge_installed_and_requires_engine(garena):
    assert type(garena.modules["games.wiring"]).__name__ == "GameBridge"
    host = Client(garena, "host")
    host.send("host.start", {"sport": "bowling"}); garena.step()
    assert host.last("host.ack").d["ok"] is False and "not connected" in host.last("host.ack").d["reason"]


def test_bowling_match_over_the_contract(garena):
    proj = Client(garena, "projector"); rail = Client(garena, "rail", nickname="Bettor")
    g = FakeGameClient(garena)
    mm = garena.modules["market.wiring"]
    # keyboard player from the game client: claim + roll via game.kb
    g.client.send("game.kb", {"seat_id": "P1", "kind": "claim"}); garena.step()
    assert garena.state.seats["P1"].status == "claimed" and garena.state.seats["P1"].nickname == "Keyboard"
    g.client.send("game.request_start", {"sport": "bowling", "mode": "1p", "tier": "rookie"}); garena.step(); g.pump()
    ms = proj.last("match.start").d
    assert ms["engine"] == "client" and ms["sport"] == "bowling" and g.gc.match is not None
    rng = random.Random(1)
    rolled = {"turn": None}

    def on_input(fg):
        m = fg.gc.match
        key = (fg.gc.turn_no, len(m.cur.rolls) if m and m.cur else -1)
        if rolled["turn"] == key:
            return
        rolled["turn"] = key
        fg.client.send("game.kb", {"seat_id": "P1", "kind": "release", "params": {"lane": rng.gauss(0.5, 0.2), "speed": 0.7, "spin_dps": 150, "power": 0.7}})
    for m in mm.book.open_markets():
        rail.send("market.bet", {"market_id": m.market_id, "outcome_id": m.outcomes[0].id, "stake": 25})
    garena.step()
    g.run(400, on_input=on_input)
    end = proj.last("match.end").d
    assert end["winner"] in ("human", "house", "tie") and len(end["score"]["human"]["frames"]) == 5
    assert len(proj.of("match.turn_result")) == 5 and proj.of("agent.decision")
    assert all(m.status in ("settled", "void") for m in mm.book.markets.values())
    assert mm.ledger.total() + sum(mm.book.pending_rollover.values()) == mm.ledger.total_granted
    assert proj.of("voice.line")


def test_boxing_card_and_abort(garena):
    proj = Client(garena, "projector")
    g = FakeGameClient(garena)
    g.client.send("game.request_start", {"sport": "boxing", "mode": "card"}); garena.step(); g.pump()
    assert proj.last("match.start").d["card"] is True
    g.run(20)
    assert g.gc.match is not None and garena.modules["games.wiring"].match is not None
    host = Client(garena, "host")
    host.send("host.next", {}); garena.step(); g.pump()
    assert proj.last("match.end").d["reason"] == "skipped" and g.gc.match is None


def test_two_player_needs_two_seats_and_engine_disconnect_ends_match(garena):
    proj = Client(garena, "projector")
    g = FakeGameClient(garena)
    g.client.send("game.request_start", {"sport": "boxing", "mode": "2p"}); garena.step(); g.pump()
    assert proj.last("match.start") is None
    assert tuple(garena.state.seats) == ("A", "B")
    g.client.send("game.kb", {"seat_id": "A", "kind": "claim"}); g.client.send("game.kb", {"seat_id": "B", "kind": "claim"}); garena.step()
    g.client.send("game.request_start", {"sport": "boxing", "mode": "2p"}); garena.step(); g.pump()
    assert proj.last("match.start").d["mode"] == "2p" and proj.last("match.start").d["human_seats"] == ["A", "B"]
    g.client.disconnect()
    assert proj.last("match.end").d["reason"] == "engine_disconnected"
