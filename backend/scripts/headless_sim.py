"""Headless simulation: each tier vs. an 'average human' input profile, with a FakeClock. Prints win rates per tier.

  uv run python scripts/headless_sim.py --sport bowling --matches 200
"""
from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.clock import FakeClock  # noqa: E402
from app.config import Config  # noqa: E402
from app.motion.detectors import Gesture  # noqa: E402
from app.wiring import build_arena  # noqa: E402

PROFILES = {
    # bowling: a human aims at the pocket; aim_sigma is the error of where the ball ends up relative to the pocket
    "bowling": {"aim_sigma": 0.22, "speed_mean": 0.6, "speed_sigma": 0.15, "spin_mean": 150, "spin_sigma": 100},
    "baseball": {"dt_ms": -20, "dt_sigma": 60, "swing_rate": 0.85},
    "boxing": {"interval_ms": 900, "interval_sigma": 200, "hook_p": 0.3, "block_p": 0.25},
}


class FakeSeat:
    """Claims a seat without a socket and injects gestures straight into the games module (detectors bypassed)."""

    def __init__(self, arena, nickname="Sim"):
        from app.arena import Connection, SendQueue, Intent
        self.arena = arena
        self.device_id = f"sim-{random.randrange(10**6)}"
        conn = Connection(f"c-{self.device_id}", "remote", self.device_id, SendQueue())
        arena.loop.add_connection(conn)
        tok = arena.state.seats["P1"].token
        arena.loop.submit(Intent("session.hello", {"role": "remote", "device_id": self.device_id, "token": tok, "nickname": nickname}, self.device_id, conn.conn_id, "remote"))
        arena.step()
        self.conn = conn
        arena.state.devices[self.device_id].calibrated = True
        arena.state.devices[self.device_id].hz = 60.0   # looks like a streaming phone (gap-pause applies)
        self.touch()

    def touch(self):
        self.arena.rooms.touch_frame(self.device_id, self.arena.loop.clock.now())

    def gesture(self, kind, power=0.6, extra=None, t=None):
        now_ms = self.arena.loop.clock.now_ms()
        g = Gesture(kind, t_phone=t or now_ms, power=power, extra=extra or {})
        g.device_id, g.seat_id, g.t_server = self.device_id, "P1", t or now_ms
        self.arena.modules["games.wiring"].on_gesture(g)


def play_match(arena, clock, seat: FakeSeat, sport: str, tier: str, profile: dict, rng: random.Random, seed: int | None = None, dt: float = 0.1, max_s: float = 600) -> str:
    games = arena.modules["games.wiring"]
    games.start_match(sport, tier, None, None, seed=seed)
    arena.step()
    acted_prompt = None
    swung_pitch = None
    t_end = clock.now() + max_s
    last_punch = clock.now()
    while games.match and not games.match.ended and clock.now() < t_end:
        clock.advance(dt)
        seat.touch()
        arena.step()
        m = games.match
        if m is None or m.ended:
            break
        if games.phase == "input" and not games.paused:
            if sport == "bowling":
                key = (m.turn_no, len(m.cur.rolls) if m.cur else -1)
                if acted_prompt != key:
                    acted_prompt = key
                    clock.advance(0.5); arena.step()
                    speed = max(0.05, min(1, rng.gauss(profile["speed_mean"], profile["speed_sigma"])))
                    spin = rng.gauss(profile["spin_mean"], profile["spin_sigma"])
                    hand = 1 if spin >= 0 else -1
                    hook = hand * 0.8 * max(-1, min(1, spin / 400)) * (1 - 0.5 * speed)
                    standing = m.cur.standing if m.cur else None
                    if standing and len(standing) < 10:
                        from app.games.bowling import PIN_X
                        target = sum(PIN_X[i] for i in standing) / len(standing)
                    else:
                        target = hand * 0.29
                    lane = max(-1, min(1, rng.gauss(target + hook, profile["aim_sigma"])))
                    seat.gesture("release", power=speed, extra={"lane": lane, "spin_dps": spin, "speed": speed})
                    arena.step()
            elif sport == "baseball":
                pitch = getattr(m, "pitch_no", None)
                arrival = getattr(m, "arrival_ts", None)
                if pitch is not None and arrival is not None and swung_pitch != pitch and clock.now() * 1000 >= arrival + profile["dt_ms"] - dt * 1000:
                    swung_pitch = pitch
                    if rng.random() < profile["swing_rate"]:
                        t_sw = arrival + rng.gauss(profile["dt_ms"], profile["dt_sigma"])
                        seat.gesture("swing", power=rng.uniform(0.4, 1.0), extra={"pitch_angle": rng.uniform(0.3, 0.7)}, t=t_sw)
                        arena.step()
            elif sport == "boxing":
                if clock.now() - last_punch >= rng.gauss(profile["interval_ms"], profile["interval_sigma"]) / 1000:
                    last_punch = clock.now()
                    if rng.random() < profile["block_p"]:
                        seat.gesture("block_on"); clock.advance(0.4); seat.touch(); arena.step(); seat.gesture("block_off")
                    else:
                        seat.gesture("punch", power=rng.uniform(0.3, 1.0), extra={"type": "hook" if rng.random() < profile["hook_p"] else "jab"})
                    arena.step()
    if games.match and not games.match.ended:
        games.end_match("timeout")
    return (arena.state.match or {}).get("winner", "?")


def simulate(sport: str, tier: str, n: int, seed: int = 1, profile: dict | None = None, verbose: bool = False) -> dict:
    cfg = Config.load()
    cfg.fast_timers = True
    from app.config import FAST_TIMER_OVERRIDES, _set
    for path, v in FAST_TIMER_OVERRIDES.items():
        _set(cfg.data, path, v)
    cfg.mode = "headless"
    clock = FakeClock()
    arena = build_arena(cfg, clock=clock, store=None)
    seat = FakeSeat(arena)
    rng = random.Random(seed)
    prof = profile or PROFILES[sport]
    wins = {"human": 0, "house": 0, "tie": 0, "void": 0, "?": 0}
    for i in range(n):
        w = play_match(arena, clock, seat, sport, tier, prof, rng, seed=seed * 1000 + i)
        wins[w] = wins.get(w, 0) + 1
        if verbose:
            print(i, w, arena.state.match.get("score"))
    decided = wins["human"] + wins["house"]
    return {"tier": tier, "n": n, "human_win_rate": wins["human"] / max(1, decided), **wins}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sport", default="bowling")
    ap.add_argument("--matches", type=int, default=100)
    ap.add_argument("--tier", default=None)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("-v", action="store_true")
    a = ap.parse_args()
    tiers = [a.tier] if a.tier else [t["id"] for t in Config.load().tiers(a.sport)]
    for t in tiers:
        r = simulate(a.sport, t, a.matches, a.seed, verbose=a.v)
        print(f"{a.sport:9s} {t:10s} human win rate {r['human_win_rate']:.2f}  ({r['human']}-{r['house']}-{r['tie']} ties, {r['void']} void)")
