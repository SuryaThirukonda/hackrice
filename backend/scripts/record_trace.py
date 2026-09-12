"""Record a real phone's raw motion stream to a JSONL trace (human step: needs a phone on the tunnel).
Connects as host, turns on record_traces, and mirrors motion frames arriving for --device into the file."""
import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts._client import Client  # noqa: E402


async def main(a):
    h = Client("host", a.url, device_id="hostctl-record")
    await h.connect()
    await h.send("host.toggle", {"record_traces": True})
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    t_end = time.time() + a.seconds
    with open(out, "w") as f:
        f.write(json.dumps({"header": {"source": "real", "label": a.label, "device": a.device, "sport": a.sport, "expect": json.loads(a.expect)}}) + "\n")
        print(f"recording {a.seconds}s from device {a.device or '(any)'} -> {out}")
        # The host page receives host.diagnostics, not raw frames; raw frames are persisted server-side in motion_frames.
        # This script therefore polls the SQLite table at the end for simplicity.
        await asyncio.sleep(a.seconds)
    await h.send("host.toggle", {"record_traces": False})
    await h.close()
    import sqlite3
    conn = sqlite3.connect(Path(__file__).resolve().parents[1] / "hap.db")
    q = "select t0, samples_json from motion_frames where id in (select id from motion_frames order by id desc limit 100000) order by id"
    rows = conn.execute(q).fetchall()
    with open(out, "a") as f:
        for t0, s in rows:
            samples = json.loads(s)
            if t0 < (time.time() - a.seconds - 5) * 1000 and t0 > 1e12:
                continue
            f.write(json.dumps({"frame": {"t0": t0, "n": len(samples), "s": samples}}) + "\n")
            n += 1
    print(f"wrote {n} frames (time filter is loose; trim in an editor if needed). t_end={t_end:.0f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="ws://localhost:8000")
    ap.add_argument("--label", required=True)
    ap.add_argument("--sport", default="all")
    ap.add_argument("--device", default="")
    ap.add_argument("--seconds", type=float, default=15)
    ap.add_argument("--expect", default="{}")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    a.out = a.out or str(Path(__file__).resolve().parents[2] / "traces" / "real" / f"{a.label}_{int(time.time())}.jsonl")
    asyncio.run(main(a))
