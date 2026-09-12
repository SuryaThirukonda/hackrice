import pytest

from app.clock import FakeClock
from app.config import Config
from app.wiring import build_arena
from app.arena import Connection, SendQueue, Intent


@pytest.fixture
def config():
    return Config.load()


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def arena(config, clock):
    return build_arena(config, clock=clock, store=None)


class Client:
    """A fake connection: submits intents and collects envelopes without a socket."""

    def __init__(self, arena, role, device_id=None, token=None, nickname=None):
        self.arena = arena
        self.role = role
        self.device_id = device_id or f"dev-{role}-{id(self) % 10000}"
        self.conn = Connection(conn_id=f"c-{self.device_id}", role=role, device_id=self.device_id, out=SendQueue())
        arena.loop.add_connection(self.conn)
        self.received = []
        self.send("session.hello", {"role": role, "device_id": self.device_id, "token": token, "nickname": nickname, "time_origin": 0})
        arena.step()
        self.pump()

    def send(self, t, d=None, cseq=0):
        self.arena.loop.submit(Intent(t=t, d=d or {}, device_id=self.device_id, conn_id=self.conn.conn_id, role=self.role, cseq=cseq))

    def pump(self):
        new = self.conn.out.drain()
        self.received.extend(new)
        return new

    def of(self, t):
        self.pump()
        return [e for e in self.received if e.t == t]

    def last(self, t):
        xs = self.of(t)
        return xs[-1] if xs else None

    def disconnect(self):
        self.arena.loop.remove_connection(self.conn.conn_id)
        self.send("session.disconnect")
        self.arena.step()


@pytest.fixture
def make_client(arena):
    def _make(role, **kw):
        return Client(arena, role, **kw)
    return _make


def run_for(arena, clock, seconds, dt=0.05):
    """Advance fake time in dt steps, stepping the arena each time. Returns all envelopes produced."""
    out = []
    n = int(round(seconds / dt))
    for _ in range(n):
        clock.advance(dt)
        out.extend(arena.step())
    return out
