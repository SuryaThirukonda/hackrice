"""Shared asyncio WebSocket client for the fake phones and host CLI (mirrors web/src/lib/ws.ts)."""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any, Awaitable, Callable

import websockets


class Client:
    def __init__(self, role: str, url: str = "ws://localhost:8000", device_id: str | None = None, token: str | None = None, nickname: str | None = None):
        self.role, self.base, self.token, self.nickname = role, url.rstrip("/"), token, nickname
        self.device_id = device_id or f"{role}-{uuid.uuid4().hex[:8]}"
        self.ws = None
        self.cseq = 0
        self.last_seq = 0
        self.offset_ms = 0.0
        self.rtt_ms = 0.0
        self.handlers: dict[str, list[Callable[[dict], Awaitable[None] | None]]] = {}
        self.welcome: dict[str, Any] | None = None
        self.snapshot: dict[str, Any] | None = None
        self._offsets: list[float] = []
        self.received: list[dict] = []

    def on(self, t: str, fn):
        self.handlers.setdefault(t, []).append(fn)

    async def connect(self) -> None:
        self.ws = await websockets.connect(f"{self.base}/ws?role={self.role}&device={self.device_id}", max_size=2**22)
        await self.send("session.hello", {"role": self.role, "device_id": self.device_id, "token": self.token, "nickname": self.nickname,
                                          "ua": "fake-client", "time_origin": 0, "last_seq": self.last_seq})
        self._reader = asyncio.create_task(self._read())
        for _ in range(5):
            await self.ping()
            await asyncio.sleep(0.05)
        for _ in range(50):
            if self.welcome and self.snapshot:
                break
            await asyncio.sleep(0.02)

    async def close(self) -> None:
        if self.ws:
            await self.ws.close()

    async def send(self, t: str, d: dict | None = None) -> None:
        self.cseq += 1
        await self.ws.send(json.dumps({"t": t, "cseq": self.cseq, "d": d or {}}))

    async def ping(self) -> None:
        await self.send("session.ping", {"t_client": time.time() * 1000, "rtt_ms": self.rtt_ms})

    def server_now_ms(self) -> float:
        return time.time() * 1000 + self.offset_ms

    async def _read(self) -> None:
        try:
            async for raw in self.ws:
                m = json.loads(raw)
                self.received.append(m)
                if len(self.received) > 2000:
                    del self.received[:1000]
                t = m.get("t")
                if m.get("seq", 0) > self.last_seq:
                    self.last_seq = m["seq"]
                if t == "session.welcome":
                    self.welcome = m["d"]
                elif t == "session.snapshot":
                    self.snapshot = m["d"]
                elif t == "session.pong":
                    now = time.time() * 1000
                    rtt = now - m["d"]["t_client"]
                    self.rtt_ms = rtt if not self.rtt_ms else self.rtt_ms * 0.7 + rtt * 0.3
                    self._offsets.append(m["d"]["t_server"] - (m["d"]["t_client"] + rtt / 2))
                    self._offsets = self._offsets[-7:]
                    self.offset_ms = sorted(self._offsets)[len(self._offsets) // 2]
                for fn in self.handlers.get(t, []) + self.handlers.get("*", []):
                    r = fn(m)
                    if asyncio.iscoroutine(r):
                        await r
        except websockets.ConnectionClosed:
            pass

    async def wait_for(self, t: str, timeout: float = 5.0, where=None) -> dict | None:
        fut: asyncio.Future = asyncio.get_event_loop().create_future()

        def _h(m):
            if not fut.done() and (where is None or where(m)):
                fut.set_result(m)
        self.on(t, _h)
        try:
            return await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            self.handlers[t].remove(_h)


async def seat_join_url(url: str, seat_id: str) -> str | None:
    """Ask the server (as a host connection) for the current join URL of a seat."""
    h = Client("host", url, device_id="hostctl-lookup")
    await h.connect()
    try:
        for s in (h.snapshot or {}).get("seats", []):
            if s["seat_id"] == seat_id:
                return s.get("join_url")
        return None
    finally:
        await h.close()
