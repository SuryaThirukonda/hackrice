"""Host CLI over the WebSocket: drive the arena from a terminal (start matches, release seats, set params...).

  uv run python scripts/hostctl.py seats
  uv run python scripts/hostctl.py start --sport bowling --tier rookie
  uv run python scripts/hostctl.py card
  uv run python scripts/hostctl.py send host.release_seat '{"seat_id": "P1"}'
  uv run python scripts/hostctl.py watch            # print every event for --seconds
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts._client import Client  # noqa: E402


async def main(a):
    h = Client("host", a.url, device_id="hostctl")
    await h.connect()
    try:
        if a.cmd == "seats":
            for s in (h.snapshot or {}).get("seats", []):
                print(f"{s['seat_id']:8s} {s['status']:8s} {s.get('nickname') or '-':14s} {s.get('join_url') or ''}")
            print("rail:", (h.snapshot or {}).get("rail_url"))
        elif a.cmd == "snapshot":
            print(json.dumps(h.snapshot, indent=1)[: a.limit])
        elif a.cmd == "start":
            await h.send("host.start", {"sport": a.sport, "tier": a.tier, "scenario": a.scenario, "seats": a.seats})
            m = await h.wait_for("match.start", 5)
            print("match.start:", json.dumps(m["d"]) if m else "no match.start within 5 s (check host.ack)")
            ack = [x for x in h.received if x["t"] == "host.ack"]
            if ack:
                print("host.ack:", ack[-1]["d"])
        elif a.cmd == "card":
            await h.send("host.card", {})
            m = await h.wait_for("card.vote_open", 5)
            print("card:", json.dumps(m["d"]) if m else "no card.vote_open")
        elif a.cmd == "send":
            await h.send(a.type, json.loads(a.json))
            ack = await h.wait_for("host.ack", 2)
            print("ack:", ack["d"] if ack else "(none)")
        elif a.cmd == "watch":
            h.on("*", lambda m: print(f"{m['seq']:6d} {m['t']:22s} {json.dumps(m['d'])[: a.limit]}") if m["t"] not in ("motion.meter", "session.pong") else None)
            await asyncio.sleep(a.seconds)
        elif a.cmd == "wait-end":
            m = await h.wait_for("match.end", a.seconds)
            print("match.end:", json.dumps(m["d"]) if m else "timeout")
    finally:
        await asyncio.sleep(0.2)
        await h.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["seats", "snapshot", "start", "card", "send", "watch", "wait-end"])
    ap.add_argument("--url", default="ws://localhost:8000")
    ap.add_argument("--sport", default="bowling")
    ap.add_argument("--tier", default="rookie")
    ap.add_argument("--scenario", default=None)
    ap.add_argument("--seats", default=None)
    ap.add_argument("--type")
    ap.add_argument("--json", default="{}")
    ap.add_argument("--seconds", type=float, default=30)
    ap.add_argument("--limit", type=int, default=160)
    ap.add_argument("type_pos", nargs="?")
    ap.add_argument("json_pos", nargs="?")
    a = ap.parse_args()
    if a.cmd == "send":
        a.type = a.type or a.type_pos
        a.json = a.json_pos or a.json
    asyncio.run(main(a))
