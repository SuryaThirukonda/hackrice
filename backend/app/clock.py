"""Clocks: a real wall clock, a fake one for tests, and per-device phone->server offset estimation."""
from __future__ import annotations

import statistics
import time
from collections import deque


class Clock:
    def now(self) -> float:  # seconds, wall time
        raise NotImplementedError

    def now_ms(self) -> int:
        return int(self.now() * 1000)


class WallClock(Clock):
    def now(self) -> float:
        return time.time()


class FakeClock(Clock):
    def __init__(self, start: float = 1_800_000_000.0):
        self.t = start

    def now(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


class OffsetEstimator:
    """offset_ms such that t_server ≈ t_phone + offset_ms. Median of the last N ping samples."""

    def __init__(self, keep: int = 7):
        self.samples: deque[float] = deque(maxlen=keep)
        self.offset_ms: float = 0.0

    def add(self, t_client_ms: float, t_server_recv_ms: float, rtt_ms: float = 0.0) -> float:
        self.samples.append(t_server_recv_ms - (t_client_ms + rtt_ms / 2))
        self.offset_ms = statistics.median(self.samples)
        return self.offset_ms

    @property
    def ready(self) -> bool:
        return len(self.samples) >= 3
