"""Synthetic motion signals in the 13-number wire layout. Shared by tests, gen_synth_traces.py, fake_remote.py,
and ported to web/src/lib/fakeMotion.ts. Phone frame: x right, y up (long axis), z out of the screen.
Forward axis for swings/punches is y (the raise gesture in calibration picks it)."""
from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Any, Iterable

G = 9.81


def _g_vec(pose: str) -> list[float]:
    return [0.0, G, 0.0] if pose == "upright" else [0.0, 0.0, G]


def _beta(pose: str) -> float:
    return 90.0 if pose == "upright" else 0.0


def _sample(t, a, w, pose, alpha=0.0, beta=None, gamma=0.0, ag=None) -> list[float]:
    g = _g_vec(pose)
    ag = ag or [a[0] + g[0], a[1] + g[1], a[2] + g[2]]
    return [t, a[0], a[1], a[2], ag[0], ag[1], ag[2], w[0], w[1], w[2], alpha, _beta(pose) if beta is None else beta, gamma]


def rest(hz: float = 60, seconds: float = 2.0, sigma: float = 0.15, pose: str = "flat", seed: int = 1, gamma: float = 0.0, w_sigma: float = 5.0) -> list[list[float]]:
    rng = random.Random(seed)
    dt = 1000.0 / hz
    out = []
    for i in range(int(seconds * hz)):
        a = [rng.gauss(0, sigma) for _ in range(3)]
        w = [rng.gauss(0, w_sigma) for _ in range(3)]
        out.append(_sample(i * dt, a, w, pose, gamma=gamma + rng.gauss(0, 0.5)))
    return out


def raise_phone(hz: float = 60, seconds: float = 1.0, pose: str = "flat", amp: float = 4.0, seed: int = 2) -> list[list[float]]:
    """A gentle push along +y so calibration picks y as forward."""
    rng = random.Random(seed)
    dt = 1000.0 / hz
    n = int(seconds * hz)
    out = []
    for i in range(n):
        ph = i / n
        a_y = amp * math.sin(math.pi * ph)
        a = [rng.gauss(0, 0.1), a_y, rng.gauss(0, 0.1)]
        w = [rng.gauss(0, 8), rng.gauss(0, 8), rng.gauss(0, 8)]
        out.append(_sample(i * dt, a, w, pose))
    return out


def swing(hz: float = 60, peak: float = 25.0, width_ms: float = 120.0, lead_ms: float = 400.0, tail_ms: float = 500.0,
          omega_peak: float = 400.0, gamma_lane: float = 0.0, spin_dps: float = 0.0, pose: str = "upright",
          sigma: float = 0.15, seed: int = 3) -> list[list[float]]:
    """Rest -> rotation ramps up -> gaussian acceleration bump on +y -> reversal lobe (zero crossing at +0.5 width) -> rest."""
    rng = random.Random(seed)
    dt = 1000.0 / hz
    total = lead_ms + tail_ms + 4 * width_ms
    tc = lead_ms + 2 * width_ms
    out = []
    t = 0.0
    while t <= total:
        tau = t - tc
        if tau <= 0:
            a_y = peak * math.exp(-(tau / width_ms) ** 2)
        else:
            a_y = peak * math.exp(-(tau / width_ms) ** 2) * math.cos(math.pi * tau / width_ms)
        a = [rng.gauss(0, sigma), a_y + rng.gauss(0, sigma), rng.gauss(0, sigma)]
        wx = omega_peak * math.exp(-((tau + 0.6 * width_ms) / (1.6 * width_ms)) ** 2)
        wy = spin_dps * math.exp(-(tau / width_ms) ** 2)
        w = [wx + rng.gauss(0, 5), wy + rng.gauss(0, 5), rng.gauss(0, 5)]
        out.append(_sample(t, a, w, pose, gamma=gamma_lane + rng.gauss(0, 0.5)))
        t += dt
    return out


def walk(hz: float = 60, seconds: float = 10.0, step_hz: float = 1.8, amp: float = 4.0, seed: int = 4) -> list[list[float]]:
    rng = random.Random(seed)
    dt = 1000.0 / hz
    out = []
    for i in range(int(seconds * hz)):
        t = i * dt
        ph = 2 * math.pi * step_hz * t / 1000.0
        a = [0.4 * amp * math.sin(ph * 0.5) + rng.gauss(0, 0.3), 0.5 * amp * math.sin(ph) + rng.gauss(0, 0.3), amp * math.sin(ph) + rng.gauss(0, 0.3)]
        w = [60 * math.sin(ph) + rng.gauss(0, 5), 25 * math.sin(ph * 0.5) + rng.gauss(0, 5), rng.gauss(0, 5)]
        out.append(_sample(t, a, w, "flat", gamma=8 * math.sin(ph * 0.5)))
    return out


def fidget(hz: float = 60, seconds: float = 8.0, seed: int = 5) -> list[list[float]]:
    """Random sub-threshold bumps (6-9 m/s^2) with enough rotation to arm the swing detector but never a peak."""
    rng = random.Random(seed)
    dt = 1000.0 / hz
    n = int(seconds * hz)
    bumps = [(rng.uniform(0.3, seconds - 0.3) * 1000, rng.uniform(6, 9), rng.uniform(60, 120)) for _ in range(int(seconds * 1.5))]
    out = []
    for i in range(n):
        t = i * dt
        a = [rng.gauss(0, 0.2) for _ in range(3)]
        w = [rng.gauss(0, 8) for _ in range(3)]
        for tb, amp, wamp in bumps:
            k = math.exp(-((t - tb) / 90.0) ** 2)
            a[rng.randrange(3)] += amp * k
            w[0] += 150 * k
        out.append(_sample(t, a, w, "upright"))
    return out


def punch(hz: float = 60, kind: str = "jab", peak: float = 18.0, rise_ms: float = 60.0, quiet_ms: float = 350.0, tail_ms: float = 300.0,
          yaw_peak: float | None = None, seed: int = 6) -> list[list[float]]:
    rng = random.Random(seed)
    yaw = (320.0 if kind == "hook" else 40.0) if yaw_peak is None else yaw_peak
    dt = 1000.0 / hz
    out = []
    t = 0.0
    total = quiet_ms + rise_ms + 80 + tail_ms
    while t <= total:
        tau = t - quiet_ms
        if tau < 0:
            a_y = 0.0
        elif tau <= rise_ms:
            a_y = peak * tau / rise_ms
        else:
            a_y = peak * math.exp(-((tau - rise_ms) / 40.0) ** 2)
        wz = yaw * math.exp(-((tau - rise_ms) / 60.0) ** 2) if tau >= -40 else 0.0
        a = [rng.gauss(0, 0.1), a_y + rng.gauss(0, 0.1), rng.gauss(0, 0.1)]
        w = [rng.gauss(0, 4), rng.gauss(0, 4), wz + rng.gauss(0, 4)]
        out.append(_sample(t, a, w, "upright"))
        t += dt
    return out


def block(hz: float = 60, seconds: float = 1.0, seed: int = 7) -> list[list[float]]:
    return rest(hz, seconds, sigma=0.08, pose="upright", seed=seed, w_sigma=3)


def unblock(hz: float = 60, seconds: float = 0.5, seed: int = 8) -> list[list[float]]:
    """Phone drops to flat: leaves the upright/still condition."""
    rng = random.Random(seed)
    dt = 1000.0 / hz
    out = []
    n = int(seconds * hz)
    for i in range(n):
        ph = i / max(1, n - 1)
        beta = 90 * (1 - ph)
        a = [rng.gauss(0, 0.3), rng.gauss(0, 0.3), 2.5 + rng.gauss(0, 0.3)]
        w = [120 + rng.gauss(0, 5), rng.gauss(0, 5), rng.gauss(0, 5)]
        out.append(_sample(i * dt, a, w, "upright", beta=beta))
    return out


def dodge(hz: float = 60, gamma_delta: float = 45.0, over_ms: float = 100.0, lead_ms: float = 300.0, tail_ms: float = 300.0, seed: int = 9, with_spike: bool = False) -> list[list[float]]:
    rng = random.Random(seed)
    dt = 1000.0 / hz
    out = []
    t = 0.0
    total = lead_ms + over_ms + tail_ms
    while t <= total:
        tau = t - lead_ms
        gamma = 0.0 if tau < 0 else (gamma_delta * min(1.0, tau / over_ms))
        a = [rng.gauss(0, 0.2), rng.gauss(0, 0.2), rng.gauss(0, 0.2)]
        if with_spike and 0 <= tau <= over_ms:
            a[1] += 14.0
        w = [rng.gauss(0, 5), rng.gauss(0, 5), (gamma_delta / over_ms * 1000 if 0 <= tau <= over_ms else 0) + rng.gauss(0, 5)]
        out.append(_sample(t, a, w, "upright", gamma=gamma))
        t += dt
    return out


def shake(hz: float = 60, peaks: int = 4, within_ms: float = 800.0, amp: float = 11.0, seed: int = 10) -> list[list[float]]:
    rng = random.Random(seed)
    dt = 1000.0 / hz
    f = peaks / (within_ms / 1000.0)
    out = []
    t = 0.0
    total = within_ms + 400
    while t <= total:
        env = 1.0 if t <= within_ms else 0.0
        a_x = env * amp * math.sin(2 * math.pi * f * t / 1000.0)
        a = [a_x + rng.gauss(0, 0.2), rng.gauss(0, 0.2), rng.gauss(0, 0.2)]
        w = [rng.gauss(0, 5), rng.gauss(0, 5), 70 * env * math.sin(2 * math.pi * f * t / 1000.0)]
        out.append(_sample(t, a, w, "flat"))
        t += dt
    return out


def flick(hz: float = 60, peak: float = 16.0, seed: int = 11) -> list[list[float]]:
    rng = random.Random(seed)
    dt = 1000.0 / hz
    out = []
    t = 0.0
    while t <= 700:
        tau = t - 300
        if 0 <= tau < 50:
            a_y = peak * math.sin(math.pi * tau / 50)
        elif 50 <= tau < 110:
            a_y = -0.55 * peak * math.sin(math.pi * (tau - 50) / 60)
        else:
            a_y = 0.0
        a = [rng.gauss(0, 0.1), a_y + rng.gauss(0, 0.1), rng.gauss(0, 0.1)]
        w = [rng.gauss(0, 5) + (150 if 0 <= tau < 110 else 0), rng.gauss(0, 5), rng.gauss(0, 5)]
        out.append(_sample(t, a, w, "flat"))
        t += dt
    return out


def bump(hz: float = 60, peak: float = 30.0, width_ms: float = 30.0, at_ms: float = 300.0, seed: int = 12) -> list[list[float]]:
    rng = random.Random(seed)
    dt = 1000.0 / hz
    out = []
    t = 0.0
    while t <= at_ms + 400:
        k = math.exp(-((t - at_ms) / (width_ms / 2)) ** 2)
        a = [rng.gauss(0, 0.1), rng.gauss(0, 0.1), peak * k + rng.gauss(0, 0.1)]
        w = [rng.gauss(0, 5) for _ in range(3)]
        out.append(_sample(t, a, w, "flat"))
        t += dt
    return out


def calibration_sequence(hz: float = 60, pose: str = "flat", rest_s: float = 2.2, raise_s: float = 1.1, seed: int = 20) -> list[list[float]]:
    return compose(rest(hz, rest_s, pose=pose, seed=seed), raise_phone(hz, raise_s, pose=pose, seed=seed + 1))


def compose(*segments: list[list[float]], gap_ms: float = 0.0) -> list[list[float]]:
    """Concatenate segments with contiguous timestamps."""
    out: list[list[float]] = []
    t_off = 0.0
    for seg in segments:
        if not seg:
            continue
        seg_t0 = seg[0][0]
        for s in seg:
            row = list(s)
            row[0] = t_off + (s[0] - seg_t0)
            out.append(row)
        dt = (seg[-1][0] - seg[0][0]) / max(1, len(seg) - 1)
        t_off = out[-1][0] + dt + gap_ms
    return out


def shift(samples: list[list[float]], t0: float) -> list[list[float]]:
    return [[s[0] + t0] + s[1:] for s in samples]


def to_frames(samples: Iterable[list[float]], batch_ms: float = 50.0) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    cur: list[list[float]] = []
    start: float | None = None
    for s in samples:
        if start is None:
            start = s[0]
        if s[0] - start >= batch_ms and cur:
            frames.append({"t0": cur[0][0], "n": len(cur), "s": cur})
            cur, start = [], s[0]
        cur.append(s)
    if cur:
        frames.append({"t0": cur[0][0], "n": len(cur), "s": cur})
    return frames


def write_trace(path: str | Path, samples: list[list[float]], header: dict[str, Any], batch_ms: float = 50.0) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        f.write(json.dumps({"header": header}) + "\n")
        for fr in to_frames(samples, batch_ms):
            f.write(json.dumps({"frame": {"t0": fr["t0"], "n": fr["n"], "s": [[round(x, 4) for x in s] for s in fr["s"]]}}) + "\n")


def read_trace(path: str | Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    header: dict[str, Any] = {}
    frames: list[dict[str, Any]] = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if "header" in obj:
                header = obj["header"]
            elif "frame" in obj:
                frames.append(obj["frame"])
    return header, frames


# Catalog used by gen_synth_traces.py and the table-driven detector test.
def catalog(hz: float = 60) -> dict[str, tuple[list[list[float]], dict[str, Any]]]:
    pose_cal = lambda pose: calibration_sequence(hz, pose)  # noqa: E731
    items: dict[str, tuple[list[list[float]], dict[str, Any]]] = {
        "bowling_swing": (compose(pose_cal("upright"), rest(hz, 0.5, pose="upright"), swing(hz, gamma_lane=-12, spin_dps=250), rest(hz, 0.5, pose="upright")),
                          {"sport": "bowling", "expect": {"swing": 1, "release": 1}}),
        "baseball_swing": (compose(pose_cal("upright"), rest(hz, 0.5, pose="upright"), swing(hz, peak=30), rest(hz, 0.5, pose="upright")),
                           {"sport": "baseball", "expect": {"swing": 1}}),
        "two_swings": (compose(pose_cal("upright"), swing(hz), rest(hz, 0.3, pose="upright"), swing(hz, seed=33), rest(hz, 0.3, pose="upright")),
                       {"sport": "baseball", "expect": {"swing": 2}}),
        "walk": (compose(pose_cal("flat"), walk(hz, 10)), {"sport": "bowling", "expect": {}}),
        "fidget": (compose(pose_cal("upright"), fidget(hz, 8)), {"sport": "bowling", "expect": {}}),
        "rest_only": (compose(pose_cal("upright"), rest(hz, 5, pose="upright")), {"sport": "baseball", "expect": {}}),
        "punch_jab": (compose(pose_cal("upright"), punch(hz, "jab"), rest(hz, 0.3, pose="upright", sigma=0.05)), {"sport": "boxing", "expect": {"punch": 1}, "punch_type": "jab"}),
        "punch_hook": (compose(pose_cal("upright"), punch(hz, "hook"), rest(hz, 0.3, pose="upright", sigma=0.05)), {"sport": "boxing", "expect": {"punch": 1}, "punch_type": "hook"}),
        "block": (compose(pose_cal("upright"), unblock(hz), rest(hz, 0.3, pose="flat"), block(hz, 1.0), unblock(hz)), {"sport": "boxing", "expect": {"block_on": 1, "block_off": 1}}),
        "dodge": (compose(pose_cal("upright"), dodge(hz)), {"sport": "boxing", "expect": {"dodge": 1}}),
        "shake": (compose(pose_cal("flat"), shake(hz)), {"sport": "dice", "expect": {"shake": 1}}),
        "flick": (compose(pose_cal("flat"), flick(hz)), {"sport": "dice", "expect": {"flick": 1}}),
        "bump": (compose(pose_cal("flat"), bump(hz)), {"sport": "idle", "expect": {"bump": 1}}),
    }
    return items
