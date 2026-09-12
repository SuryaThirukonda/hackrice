"""Speak the game-client contract from Python: connects as role=game and runs the Python engines behind it.
Use it to run the arena in HAP_ENGINE=client mode without the Phaser client, or as the demo-day fallback.

  HAP_ENGINE=client uv run uvicorn app.main:app --port 8000     (in another terminal)
  uv run python scripts/fake_game.py --url ws://localhost:8000
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config  # noqa: E402
from app.games.gameclient import PythonGameClient  # noqa: E402
from scripts._client import Client  # noqa: E402


async def main(a):
    cfg = Config.load()
    c = Client("game", a.url, device_id="fake-game")
    out: asyncio.Queue = asyncio.Queue()
    gc = PythonGameClient(cfg, lambda t, d: out.put_nowait((t, d)), lambda: time.time() * 1000 + c.offset_ms)
    c.on("*", lambda m: gc.handle(m["t"], m["d"]) if m["t"].startswith("game.") else None)
    await c.connect()
    await c.send("game.hello", {"engine": "python-fake", "version": "1"})
    print("[fake_game] connected as game; waiting for game.start")
    t_end = time.time() + a.seconds

    async def pump():
        while True:
            t, d = await out.get()
            await c.send(t, d)
    asyncio.create_task(pump())
    while time.time() < t_end:
        gc.step()
        await asyncio.sleep(0.05)
    await c.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="ws://localhost:8000")
    ap.add_argument("--seconds", type=float, default=3600)
    asyncio.run(main(ap.parse_args()))
