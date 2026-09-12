import asyncio
import statistics
import time

import pytest

from app.arena import ArenaLoop
from app.config import Config


@pytest.mark.asyncio
async def test_real_clock_tick_jitter():
    """The boxing tick loop, proven before boxing exists: 50 ms timer over 2 s with p95 jitter < 10 ms."""
    loop = ArenaLoop(Config.load())
    stamps = []
    loop.schedule_every(0.05, lambda: stamps.append(time.perf_counter()), key="tick")
    task = asyncio.create_task(loop.run())
    await asyncio.sleep(2.0)
    loop.stop(); await asyncio.wait_for(task, 1)
    gaps = [(b - a) * 1000 for a, b in zip(stamps, stamps[1:])]
    assert len(stamps) >= 35
    jitter = sorted(abs(g - 50) for g in gaps)
    p95 = jitter[int(len(jitter) * 0.95) - 1]
    assert p95 < 10, f"p95 jitter {p95:.1f} ms, median gap {statistics.median(gaps):.1f}"
