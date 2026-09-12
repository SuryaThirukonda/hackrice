"""ArenaLoop: the single writer.

WebSocket handlers and background tasks never touch state; they put Intents on `intents`.
The loop consumes intents in order, runs due timers, then flushes events (stamping a global seq)
to per-connection bounded send queues. `step()` is synchronous so tests drive it with a FakeClock.
"""
from __future__ import annotations

import asyncio
import heapq
import itertools
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable

from .clock import Clock, WallClock
from .protocol import DROPPABLE, Envelope, ROLES

log = logging.getLogger("hap.arena")

Handler = Callable[["Intent"], None]


@dataclass
class Intent:
    t: str
    d: dict[str, Any] = field(default_factory=dict)
    device_id: str | None = None
    conn_id: str | None = None
    role: str | None = None
    cseq: int = 0


class SendQueue:
    """Bounded outbox per connection. When full, droppable high-rate messages go first.
    `seq` is per connection and assigned to what is actually queued, so a client only sees a gap on real loss."""

    def __init__(self, maxlen: int = 256):
        self.q: deque[Envelope] = deque()
        self.maxlen = maxlen
        self.event = asyncio.Event() if _has_loop() else None
        self.dropped = 0
        self.closed = False
        self.seq = 0

    def push(self, env: Envelope) -> None:
        if len(self.q) >= self.maxlen:
            if env.t in DROPPABLE:
                self.dropped += 1
                return
            for i, old in enumerate(self.q):
                if old.t in DROPPABLE:
                    del self.q[i]
                    self.dropped += 1
                    break
            else:
                self.q.popleft()
                self.dropped += 1
        self.seq += 1
        self.q.append(env.model_copy(update={"seq": self.seq}))
        if self.event is not None:
            self.event.set()

    def drain(self) -> list[Envelope]:
        out = list(self.q)
        self.q.clear()
        if self.event is not None:
            self.event.clear()
        return out

    async def wait(self) -> None:
        if self.event is None:
            self.event = asyncio.Event()
        if not self.q:
            await self.event.wait()


def _has_loop() -> bool:
    try:
        asyncio.get_running_loop()
        return True
    except RuntimeError:
        return False


@dataclass
class Connection:
    conn_id: str
    role: str
    device_id: str | None
    out: SendQueue


@dataclass(order=True)
class _Timer:
    due: float
    n: int
    key: str = field(compare=False)
    cb: Callable[[], None] = field(compare=False)
    interval: float | None = field(compare=False, default=None)


class ArenaLoop:
    def __init__(self, config, clock: Clock | None = None, store=None):
        self.config = config
        self.clock = clock or WallClock()
        self.store = store
        self.intents: asyncio.Queue[Intent] | None = None
        self._pending: deque[Intent] = deque()          # used when no asyncio loop (tests)
        self.conns: dict[str, Connection] = {}
        self.handlers: dict[str, list[Handler]] = {}
        self.seq = 0
        self.match_id: str | None = None
        self._outbox: list[tuple[Envelope, Any]] = []
        self._timers: list[_Timer] = []
        self._timer_keys: dict[str, int] = {}
        self._n = itertools.count()
        self._wake: asyncio.Event | None = None
        self.running = False
        self.emitted_total = 0

    # ---- registration -------------------------------------------------
    def on(self, t: str, handler: Handler) -> None:
        self.handlers.setdefault(t, []).append(handler)

    def add_connection(self, conn: Connection) -> None:
        self.conns[conn.conn_id] = conn

    def remove_connection(self, conn_id: str) -> Connection | None:
        return self.conns.pop(conn_id, None)

    # ---- intents --------------------------------------------------------
    def submit(self, intent: Intent) -> None:
        """Thread-unsafe fast path for the event loop thread; background tasks use submit_threadsafe."""
        if self.intents is not None:
            self.intents.put_nowait(intent)
        else:
            self._pending.append(intent)

    def submit_threadsafe(self, loop: asyncio.AbstractEventLoop, intent: Intent) -> None:
        loop.call_soon_threadsafe(self.submit, intent)

    # ---- timers ---------------------------------------------------------
    def schedule_in(self, delay_s: float, cb: Callable[[], None], key: str | None = None) -> str:
        return self._schedule(self.clock.now() + max(0.0, delay_s), cb, key, None)

    def schedule_at(self, ts: float, cb: Callable[[], None], key: str | None = None) -> str:
        return self._schedule(ts, cb, key, None)

    def schedule_every(self, interval_s: float, cb: Callable[[], None], key: str | None = None) -> str:
        return self._schedule(self.clock.now() + interval_s, cb, key, interval_s)

    def _schedule(self, due, cb, key, interval) -> str:
        n = next(self._n)
        key = key or f"t{n}"
        self.cancel(key)
        self._timer_keys[key] = n
        heapq.heappush(self._timers, _Timer(due, n, key, cb, interval))
        if self._wake is not None:
            self._wake.set()
        return key

    def cancel(self, key: str) -> bool:
        return self._timer_keys.pop(key, None) is not None

    def has_timer(self, key: str) -> bool:
        return key in self._timer_keys

    def next_deadline(self) -> float | None:
        while self._timers:
            t = self._timers[0]
            if self._timer_keys.get(t.key) == t.n:
                return t.due
            heapq.heappop(self._timers)
        return None

    def run_due_timers(self, now: float | None = None) -> int:
        now = self.clock.now() if now is None else now
        fired = 0
        while self._timers and self._timers[0].due <= now:
            t = heapq.heappop(self._timers)
            if self._timer_keys.get(t.key) != t.n:
                continue  # cancelled or replaced
            if t.interval is not None:
                n = next(self._n)
                self._timer_keys[t.key] = n
                heapq.heappush(self._timers, _Timer(t.due + t.interval, n, t.key, t.cb, t.interval))
            else:
                self._timer_keys.pop(t.key, None)
            try:
                t.cb()
            except Exception:
                log.exception("timer %s failed", t.key)
            fired += 1
            if fired > 10_000:
                break
        return fired

    # ---- emit -----------------------------------------------------------
    def emit(self, t: str, d: dict[str, Any] | None = None, to: Any = "all", match: str | None = None) -> None:
        """to: 'all' | a role name | ('device', id) | ('conn', id) | list of those."""
        env = Envelope(t=t, seq=0, match=match if match is not None else self.match_id, ts=self.clock.now_ms(), d=d or {})
        self._outbox.append((env, to))

    def flush_events(self) -> list[Envelope]:
        out: list[Envelope] = []
        for env, to in self._outbox:
            self.seq += 1
            env.seq = self.seq
            out.append(env)
            for conn in self._route(to):
                conn.out.push(env)
        self._outbox.clear()
        self.emitted_total += len(out)
        return out

    def _route(self, to: Any) -> list[Connection]:
        if isinstance(to, list):
            seen: dict[str, Connection] = {}
            for x in to:
                for c in self._route(x):
                    seen[c.conn_id] = c
            return list(seen.values())
        if to == "all":
            return list(self.conns.values())
        if isinstance(to, str) and to in ROLES:
            return [c for c in self.conns.values() if c.role == to]
        if isinstance(to, tuple) and len(to) == 2:
            kind, ident = to
            if kind == "device":
                return [c for c in self.conns.values() if c.device_id == ident]
            if kind == "conn":
                c = self.conns.get(ident)
                return [c] if c else []
        return []

    # ---- stepping -------------------------------------------------------
    def handle(self, intent: Intent) -> None:
        hs = self.handlers.get(intent.t)
        if not hs:
            log.debug("no handler for %s", intent.t)
            return
        for h in hs:
            try:
                h(intent)
            except Exception:
                log.exception("handler for %s failed", intent.t)

    def _drain_intents(self) -> list[Intent]:
        items: list[Intent] = []
        if self.intents is not None:
            while True:
                try:
                    items.append(self.intents.get_nowait())
                except asyncio.QueueEmpty:
                    break
        while self._pending:
            items.append(self._pending.popleft())
        return items

    def step(self, now: float | None = None) -> list[Envelope]:
        """One synchronous iteration: drain intents, run due timers, flush. Returns the envelopes produced."""
        for intent in self._drain_intents():
            self.handle(intent)
        self.run_due_timers(now)
        return self.flush_events()

    async def run(self) -> None:
        self.intents = asyncio.Queue()
        self._wake = asyncio.Event()
        for i in list(self._pending):
            self.intents.put_nowait(i)
        self._pending.clear()
        self.running = True
        try:
            while self.running:
                dl = self.next_deadline()
                timeout = None if dl is None else max(0.0, dl - self.clock.now())
                if timeout is not None and timeout > 0.5:
                    timeout = 0.5
                self._wake.clear()
                waiter = asyncio.ensure_future(self.intents.get())
                wake = asyncio.ensure_future(self._wake.wait())
                done, _ = await asyncio.wait({waiter, wake}, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
                first: Intent | None = None
                if waiter in done:
                    first = waiter.result()
                else:
                    waiter.cancel()
                if wake not in done:
                    wake.cancel()
                if first is not None:
                    self.handle(first)
                self.step()
        finally:
            self.running = False

    def stop(self) -> None:
        self.running = False
        if self._wake is not None:
            self._wake.set()
