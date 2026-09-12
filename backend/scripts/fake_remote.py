"""A phone stand-in: streams synthetic (or recorded) motion over the real WebSocket exactly like web/src/lib/motion.ts.

Examples
  uv run python scripts/fake_remote.py --seat P1 --gen swing --repeat 3
  uv run python scripts/fake_remote.py --seat P1 --gen walk --seconds 10
  uv run python scripts/fake_remote.py --seat P1 --trace ../traces/synth/bowling_swing_60hz.jsonl
  uv run python scripts/fake_remote.py --seat P1 --auto                      # plays whole matches (reacts to match.phase)
  uv run python scripts/fake_remote.py --seat P1 --auto --sport boxing --pattern jab,jab,hook --interval-ms 900
  uv run python scripts/fake_remote.py --seat P1 --auto --sport baseball --dt-ms -20 --dt-jitter 60
"""
from __future__ import annotations

import argparse
import asyncio
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.motion import synth  # noqa: E402
from scripts._client import Client, seat_join_url  # noqa: E402

HZ = 60.0


def gen_segment(kind: str, hz: float = HZ, seed: int | None = None, **kw) -> tuple[list[list[float]], float]:
    """Returns (samples, peak_offset_ms): where inside the segment the 'moment' (peak) sits."""
    seed = seed if seed is not None else random.randrange(1, 10_000)
    if kind == "swing":
        w = kw.get("width_ms", 120.0); lead = kw.get("lead_ms", 250.0)
        return synth.swing(hz, peak=kw.get("peak", 26.0), width_ms=w, lead_ms=lead, tail_ms=250, gamma_lane=kw.get("lane", 0.0),
                           spin_dps=kw.get("spin", 120.0), seed=seed), lead + 2 * w
    if kind.startswith("punch"):
        ptype = kind.split(":")[1] if ":" in kind else "jab"
        return synth.punch(hz, ptype, quiet_ms=250, tail_ms=200, seed=seed), 250 + 60
    if kind == "block":
        return synth.block(hz, kw.get("seconds", 1.2), seed=seed), 200
    if kind == "unblock":
        return synth.unblock(hz, 0.4, seed=seed), 0
    if kind == "dodge":
        return synth.dodge(hz, lead_ms=150, tail_ms=150, seed=seed), 150
    if kind == "shake":
        return synth.shake(hz, seed=seed), 400
    if kind == "flick":
        return synth.flick(hz, seed=seed), 300
    if kind == "bump":
        return synth.bump(hz, seed=seed), 300
    if kind == "walk":
        return synth.walk(hz, kw.get("seconds", 10.0), seed=seed), 0
    raise SystemExit(f"unknown gesture {kind}")


class Streamer:
    """Real-time frame sender with a segment queue. Idle = quiet rest in the given pose."""

    def __init__(self, client: Client, hz: float = HZ, batch_ms: float = 50.0, pose: str = "upright"):
        self.client, self.hz, self.batch_ms, self.pose = client, hz, batch_ms, pose
        self.queue: list[tuple[float | None, list[list[float]]]] = []   # (start_at_local_ms or None, samples)
        self.t_phone = 0.0
        self.frames_sent = 0
        self._task: asyncio.Task | None = None
        self._pending: list[list[float]] = []
        self._rest_i = 0

    def enqueue(self, samples: list[list[float]], at_local_ms: float | None = None) -> None:
        self.queue.append((at_local_ms, samples))

    def _rest_samples(self, n: int) -> list[list[float]]:
        out = []
        rng = random.Random(self._rest_i)
        self._rest_i += 1
        for _ in range(n):
            out.append(synth._sample(0.0, [rng.gauss(0, 0.12) for _ in range(3)], [rng.gauss(0, 4) for _ in range(3)], self.pose))
        return out

    async def run(self) -> None:
        dt = 1000.0 / self.hz
        per_batch = max(1, int(round(self.batch_ms / dt)))
        next_send = time.perf_counter()
        base_ms = time.time() * 1000
        while True:
            now_local = time.time() * 1000
            # pull the next due segment into the pending buffer
            if not self._pending and self.queue:
                at, samples = self.queue[0]
                if at is None or now_local >= at:
                    self.queue.pop(0)
                    self._pending = [list(s) for s in samples]
            if self._pending:
                chunk, self._pending = self._pending[:per_batch], self._pending[per_batch:]
            else:
                chunk = self._rest_samples(per_batch)
            frame = []
            for s in chunk:
                row = list(s)
                row[0] = base_ms + self.t_phone
                self.t_phone += dt
                frame.append([round(x, 4) for x in row])
            await self.client.send("motion.frame", {"t0": frame[0][0], "n": len(frame), "s": frame})
            self.frames_sent += 1
            next_send += self.batch_ms / 1000
            await asyncio.sleep(max(0.0, next_send - time.perf_counter()))

    def start(self) -> None:
        self._task = asyncio.create_task(self.run())

    def stop(self) -> None:
        if self._task:
            self._task.cancel()


async def main(a: argparse.Namespace) -> None:
    token = a.token
    if not token:
        url = await seat_join_url(a.url, a.seat)
        if not url:
            raise SystemExit(f"seat {a.seat} has no open join URL (claimed?) — pass --token")
        token = url.split("tok=")[1]
    c = Client("remote", a.url, device_id=a.device, token=token, nickname=a.nickname)
    await c.connect()
    if not c.welcome or not c.welcome.get("seat_id"):
        raise SystemExit(f"join refused: {c.welcome}")
    print(f"[fake_remote] seat {c.welcome['seat_id']} as {a.nickname} device={c.device_id}")
    st = Streamer(c, pose="upright")
    c.on("motion.calib", lambda m: print(f"[calib] {m['d']['phase']} {m['d']['progress']:.0%}") if m["d"]["phase"] != "done" or True else None)
    c.on("motion.gesture", lambda m: print(f"[gesture] {m['d']['kind']} power={m['d']['power']} extra={m['d'].get('extra')}") if m["d"].get("device_id") == c.device_id else None)
    c.on("match.phase", lambda m: print(f"[phase] turn {m['d'].get('turn_no')} {m['d'].get('phase')}"))
    c.on("match.turn_result", lambda m: print(f"[turn] {m['d'].get('outcome')} {m['d'].get('detail', '')}"))
    c.on("match.end", lambda m: print(f"[end] winner={m['d'].get('winner')} score={m['d'].get('score')}"))
    st.enqueue(synth.calibration_sequence(HZ, "upright"))
    st.start()
    calibrated = asyncio.Event()
    c.on("motion.calib", lambda m: calibrated.set() if m["d"]["phase"] == "done" else None)
    await asyncio.wait_for(calibrated.wait(), 20)
    print("[fake_remote] calibrated")

    if a.trace:
        header, frames = synth.read_trace(a.trace)
        samples = [s for fr in frames for s in fr["s"]]
        st.enqueue(samples)
        await asyncio.sleep(len(samples) / HZ + 1.0)
    elif a.gen and not a.auto:
        for i in range(a.repeat):
            seg, _ = gen_segment(a.gen, seconds=a.seconds)
            st.enqueue(seg)
            await asyncio.sleep(len(seg) / HZ + 0.6)
    if a.auto:
        await auto_play(a, c, st)
    await asyncio.sleep(0.5)
    st.stop()
    await c.close()


async def auto_play(a: argparse.Namespace, c: Client, st: Streamer) -> None:
    """React to match events: swing/roll in input windows, punch patterns in boxing, timed swings in baseball."""
    rng = random.Random(a.seed)
    sport_holder = {"sport": a.sport}
    my_seat = c.welcome["seat_id"]
    done = asyncio.Event()
    boxing_task: asyncio.Task | None = None

    def on_start(m):
        sport_holder["sport"] = m["d"]["sport"]
        print(f"[match] {m['d']['sport']} vs {m['d']['opponent']['name']} seed={m['d']['seed']}")

    async def boxing_loop(deadline_ms: float):
        pattern = [p.strip() for p in a.pattern.split(",") if p.strip()]
        i = 0
        while c.server_now_ms() < deadline_ms - 300:
            kind = pattern[i % len(pattern)]
            if kind in ("block", "dodge"):
                seg, _ = gen_segment(kind)
            else:
                seg, _ = gen_segment(f"punch:{kind}")
            st.enqueue(seg)
            i += 1
            await asyncio.sleep(max(0.35, a.interval_ms / 1000 + rng.gauss(0, a.interval_jitter_ms / 1000)))

    async def on_phase(m):
        nonlocal boxing_task
        d = m["d"]
        sport = sport_holder["sport"] or "bowling"
        if d.get("phase") != "input" or (d.get("seat_id") not in (None, my_seat)):
            if boxing_task and d.get("phase") != "input":
                boxing_task.cancel(); boxing_task = None
            return
        if sport == "bowling":
            await asyncio.sleep(a.delay_ms / 1000 + rng.uniform(0, 0.4))
            seg, _ = gen_segment("swing", lane=rng.gauss(0, 6), spin=rng.gauss(150, 100), peak=rng.uniform(18, 34))
            st.enqueue(seg)
        elif sport == "baseball":
            pass  # handled on match.tick with arrival_ts
        elif sport == "boxing":
            if boxing_task:
                boxing_task.cancel()
            boxing_task = asyncio.create_task(boxing_loop(d.get("deadline_ts", c.server_now_ms() + 30_000)))

    def on_tick(m):
        d = m["d"]
        sport = sport_holder["sport"]
        if sport == "baseball" and d.get("pitch") and d.get("arrival_ts") and d.get("pitch_no") is not None:
            if d.get("batter") not in (None, my_seat):
                return
            dt = a.dt_ms + rng.gauss(0, a.dt_jitter)
            target_server = d["arrival_ts"] + dt
            target_local = target_server - c.offset_ms
            seg, peak_off = gen_segment("swing", peak=rng.uniform(20, 34))
            st.enqueue(seg, at_local_ms=target_local - peak_off)
        if sport == "boxing" and a.block_on_telegraph and d.get("house", {}).get("state") == "telegraph":
            seg, _ = gen_segment("block", seconds=0.6)
            st.enqueue(seg)

    c.on("match.start", on_start)
    c.on("match.phase", on_phase)
    c.on("match.tick", on_tick)
    c.on("match.end", lambda m: done.set() if not a.forever else None)
    print("[fake_remote] auto mode: waiting for a match")
    try:
        await asyncio.wait_for(done.wait(), a.timeout)
    except asyncio.TimeoutError:
        print("[fake_remote] timeout")
    if boxing_task:
        boxing_task.cancel()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="ws://localhost:8000")
    ap.add_argument("--seat", default="P1")
    ap.add_argument("--token")
    ap.add_argument("--device")
    ap.add_argument("--nickname", default="Fake Phone")
    ap.add_argument("--trace")
    ap.add_argument("--gen", help="swing|punch:jab|punch:hook|block|dodge|shake|flick|bump|walk")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--auto", action="store_true")
    ap.add_argument("--forever", action="store_true")
    ap.add_argument("--sport", default=None)
    ap.add_argument("--delay-ms", type=float, default=600)
    ap.add_argument("--pattern", default="jab,jab,hook")
    ap.add_argument("--interval-ms", type=float, default=900)
    ap.add_argument("--interval-jitter-ms", type=float, default=60)
    ap.add_argument("--dt-ms", type=float, default=-20)
    ap.add_argument("--dt-jitter", type=float, default=60)
    ap.add_argument("--block-on-telegraph", action="store_true")
    ap.add_argument("--timeout", type=float, default=600)
    ap.add_argument("--seed", type=int, default=None)
    asyncio.run(main(ap.parse_args()))
