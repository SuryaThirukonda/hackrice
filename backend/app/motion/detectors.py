"""Gesture detectors: small state machines over preprocessed samples. Constants come from config/motion.yaml."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any

from .calib import Calibration
from .filters import Sample


@dataclass
class Gesture:
    kind: str                     # swing | release | punch | block_on | block_off | dodge | shake | flick | bump
    t_phone: float
    power: float = 0.0
    axis: str = "y"
    sign: int = 1
    duration_ms: float = 0.0
    extra: dict[str, Any] = field(default_factory=dict)
    t_server: float = 0.0
    device_id: str | None = None
    seat_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "t_phone": self.t_phone, "t_server": self.t_server, "power": round(self.power, 3),
                "axis": self.axis, "sign": self.sign, "duration_ms": round(self.duration_ms, 1), "extra": self.extra,
                "device_id": self.device_id, "seat_id": self.seat_id}


def _dominant_axis(v: list[float]) -> tuple[str, int]:
    i = max(range(3), key=lambda k: abs(v[k]))
    return "xyz"[i], (1 if v[i] >= 0 else -1)


def _power(peak: float, thr: float, sat: float) -> float:
    if sat <= thr:
        return 1.0
    return max(0.0, min(1.0, (peak - thr) / (sat - thr)))


class Detector:
    kinds: tuple[str, ...] = ()

    def feed(self, s: Sample) -> list[Gesture]:
        raise NotImplementedError

    def reset(self) -> None:
        pass


class SwingDetector(Detector):
    """IDLE -> ARMED (rotation sustained) -> PEAK (|a| above threshold, track max) -> emit on decay -> REFRACTORY.
    With release=True also emits a 'release' (bowling): forward-accel zero crossing after the peak near vertical tilt."""
    kinds = ("swing", "release")

    def __init__(self, cfg: dict[str, Any], calib: Calibration, sport: str = "default", release: bool = False):
        sw, rl = cfg["swing"], cfg["release"]
        self.omega_arm = float(sw["omega_arm_dps"])
        self.arm_ms = float(sw["arm_ms"])
        self.a_sat = float(sw["a_sat_ms2"])
        self.decay = float(sw["decay_ratio"])
        self.max_peak_ms = float(sw["max_peak_ms"])
        cd = sw["cooldown_ms"]
        self.cooldown = float(cd.get(sport, cd.get("default", 500)))
        self.calib = calib
        self.release = release
        self.beta_tol = float(rl["beta_vertical_deg"])
        self.lane_window = float(rl["lane_window_ms"])
        self.lane_full = float(rl["lane_full_deg"])
        self.fallback_ms = float(rl["fallback_after_peak_ms"])
        self.zero_timeout = float(rl["zero_cross_timeout_ms"])
        self.spin_full = float(rl["spin_full_dps"])
        self.gamma_hist: deque[tuple[float, float]] = deque()
        self.reset()

    def reset(self) -> None:
        self.state = "IDLE"
        self.armed_since: float | None = None
        self.t_armed = 0.0
        self.peak = 0.0
        self.t_peak = 0.0
        self.t_peak_start = 0.0
        self.w_at_peak = [0.0, 0.0, 0.0]
        self.refractory_until = 0.0
        self.pending_release: dict[str, Any] | None = None
        self.lane_at_arm = 0.0
        self.prev_fwd = 0.0

    def _lane(self, t: float) -> float:
        while self.gamma_hist and self.gamma_hist[0][0] < t - self.lane_window:
            self.gamma_hist.popleft()
        if not self.gamma_hist:
            return 0.0
        g = sum(v for _, v in self.gamma_hist) / len(self.gamma_hist)
        return max(-1.0, min(1.0, g / self.lane_full))

    def feed(self, s: Sample) -> list[Gesture]:
        out: list[Gesture] = []
        t = s.t
        thr = self.calib.a_thr
        if self.state in ("IDLE", "ARMED"):
            self.gamma_hist.append((t, s.gamma))
            while self.gamma_hist and self.gamma_hist[0][0] < t - self.lane_window:
                self.gamma_hist.popleft()
        if self.pending_release is not None:
            out.extend(self._track_release(s))
        if self.state == "REFRACTORY":
            if t >= self.refractory_until:
                self.state = "IDLE"
                self.armed_since = None
            else:
                self.prev_fwd = s.a_fwd
                return out
        if self.state == "IDLE":
            if s.w_mag > self.omega_arm:
                if self.armed_since is None:
                    self.armed_since = t
                elif t - self.armed_since >= self.arm_ms:
                    self.state = "ARMED"
                    self.t_armed = t
                    self.lane_at_arm = self._lane(t)
            else:
                self.armed_since = None
        elif self.state == "ARMED":
            if s.a_mag > thr:
                self.state = "PEAK"
                self.peak, self.t_peak, self.t_peak_start = s.a_mag, t, t
                self.w_at_peak = list(s.w)
            elif s.w_mag < self.omega_arm * 0.5 and t - self.t_armed > 400:
                self.state, self.armed_since = "IDLE", None
        elif self.state == "PEAK":
            if s.a_mag > self.peak:
                self.peak, self.t_peak, self.w_at_peak = s.a_mag, t, list(s.w)
            if s.a_mag < self.decay * self.peak or t - self.t_peak > self.max_peak_ms:
                axis, sign = _dominant_axis(self.w_at_peak)
                g = Gesture("swing", self.t_peak, _power(self.peak, thr, self.a_sat), axis, sign, t - self.t_peak_start,
                            {"peak_ms2": round(self.peak, 2), "lane": round(self.lane_at_arm, 3)})
                out.append(g)
                self.state = "REFRACTORY"
                self.refractory_until = self.t_peak + self.cooldown
                self.armed_since = None
                if self.release:
                    self.pending_release = {"t_peak": self.t_peak, "power": g.power, "lane": self.lane_at_arm, "done": False,
                                            "prev_fwd": self.prev_fwd, "spin": s.w_long, "n": 0}
                    out.extend(self._track_release(s, first=True))
        self.prev_fwd = s.a_fwd
        return out

    def _track_release(self, s: Sample, first: bool = False) -> list[Gesture]:
        pr = self.pending_release
        assert pr is not None
        t = s.t
        crossed = (pr["prev_fwd"] > 0 >= s.a_fwd) and t > pr["t_peak"] and not first
        near_vertical = s.tilt_from_vertical < self.beta_tol
        pr["prev_fwd"] = s.a_fwd
        if (crossed and near_vertical) or t - pr["t_peak"] >= self.zero_timeout or (not crossed and t - pr["t_peak"] >= self.fallback_ms and s.a_fwd <= 0):
            spin = s.w_long
            g = Gesture("release", t, pr["power"], "y", 1 if spin >= 0 else -1, t - pr["t_peak"],
                        {"lane": round(pr["lane"], 3), "spin_dps": round(spin, 1), "spin": max(-1.0, min(1.0, spin / self.spin_full)),
                         "speed": pr["power"], "via": "zero_cross" if crossed else "fallback"})
            self.pending_release = None
            return [g]
        return []


class PunchDetector(Detector):
    kinds = ("punch",)

    def __init__(self, cfg: dict[str, Any], calib: Calibration):
        p = cfg["punch"]
        self.a_fwd_thr = float(p["a_fwd_ms2"])
        self.rise_ms = float(p["rise_ms"])
        self.quiet = float(p["quiet_ms2"])
        self.hook_yaw = float(p["hook_yaw_dps"])
        self.a_sat = float(p["a_sat_ms2"])
        self.cooldown = float(p["cooldown_ms"])
        self.calib = calib
        self.reset()

    def reset(self) -> None:
        self.state = "QUIET"
        self.t_leave = 0.0
        self.peak = 0.0
        self.t_peak = 0.0
        self.w_peak = 0.0
        self.until = 0.0

    def feed(self, s: Sample) -> list[Gesture]:
        t = s.t
        if self.state == "COOL":
            if t >= self.until:
                self.state = "QUIET"
            return []
        if self.state == "QUIET":
            if s.a_mag > self.quiet:
                self.state, self.t_leave, self.peak, self.w_peak = "RISING", t, 0.0, 0.0
            return []
        if self.state == "RISING":
            self.w_peak = max(self.w_peak, s.w_mag)
            if s.a_fwd >= self.a_fwd_thr and t - self.t_leave <= self.rise_ms:
                self.state, self.peak, self.t_peak = "SPIKE", s.a_fwd, t
            elif t - self.t_leave > self.rise_ms:
                self.state = "WAIT_QUIET"
            return []
        if self.state == "SPIKE":
            self.w_peak = max(self.w_peak, s.w_mag)
            if s.a_fwd > self.peak:
                self.peak, self.t_peak = s.a_fwd, t
            if s.a_fwd < 0.5 * self.peak or t - self.t_peak > 150:
                kind = "hook" if self.w_peak > self.hook_yaw else "jab"
                g = Gesture("punch", self.t_peak, _power(self.peak, self.a_fwd_thr, self.a_sat), "y", 1, t - self.t_leave,
                            {"type": kind, "peak_ms2": round(self.peak, 2), "yaw_dps": round(self.w_peak, 1)})
                self.state, self.until = "COOL", self.t_peak + self.cooldown
                return [g]
            return []
        if self.state == "WAIT_QUIET":
            if s.a_mag < self.quiet:
                self.state = "QUIET"
            return []
        return []


class BlockDetector(Detector):
    kinds = ("block_on", "block_off")

    def __init__(self, cfg: dict[str, Any], calib: Calibration):
        b = cfg["block"]
        self.a_max = float(b["a_max_ms2"])
        self.tol = float(b["upright_tol_deg"])
        self.on_ms = float(b["on_ms"])
        self.off_ms = float(b["off_ms"])
        self.reset()

    def reset(self) -> None:
        self.on = False
        self.since: float | None = None
        self.bad_since: float | None = None

    def feed(self, s: Sample) -> list[Gesture]:
        t = s.t
        ok = s.a_mag < self.a_max and s.tilt_from_vertical < self.tol
        if not self.on:
            if ok:
                self.since = t if self.since is None else self.since
                if t - self.since >= self.on_ms:
                    self.on, self.since, self.bad_since = True, None, None
                    return [Gesture("block_on", t, 1.0, "y", 1, self.on_ms)]
            else:
                self.since = None
        else:
            if ok:
                self.bad_since = None
            else:
                self.bad_since = t if self.bad_since is None else self.bad_since
                if t - self.bad_since >= self.off_ms:
                    self.on, self.bad_since = False, None
                    return [Gesture("block_off", t, 0.0, "y", 1, self.off_ms)]
        return []


class DodgeDetector(Detector):
    kinds = ("dodge",)

    def __init__(self, cfg: dict[str, Any], calib: Calibration):
        d = cfg["dodge"]
        self.delta = float(d["gamma_delta_deg"])
        self.window = float(d["window_ms"])
        self.cooldown = float(d["cooldown_ms"])
        self.a_fwd_thr = float(cfg["punch"]["a_fwd_ms2"])
        self.reset()

    def reset(self) -> None:
        self.hist: deque[tuple[float, float, float]] = deque()  # (t, gamma, a_fwd)
        self.until = 0.0

    def feed(self, s: Sample) -> list[Gesture]:
        t = s.t
        self.hist.append((t, s.gamma, s.a_fwd))
        while self.hist and self.hist[0][0] < t - self.window:
            self.hist.popleft()
        if t < self.until or len(self.hist) < 2:
            return []
        t0, g0, _ = self.hist[0]
        if abs(s.gamma - g0) >= self.delta and not any(a > self.a_fwd_thr for _, _, a in self.hist):
            self.until = t + self.cooldown
            sign = 1 if s.gamma - g0 > 0 else -1
            self.hist.clear()
            return [Gesture("dodge", t, 1.0, "z", sign, t - t0, {"delta_deg": round(s.gamma - g0, 1)})]
        return []


class ShakeDetector(Detector):
    kinds = ("shake",)

    def __init__(self, cfg: dict[str, Any], calib: Calibration):
        sh = cfg["shake"]
        self.peaks_needed = int(sh["peaks"])
        self.window = float(sh["window_ms"])
        self.ratio = float(sh["peak_ratio"])
        self.calib = calib
        self.reset()

    def reset(self) -> None:
        self.peaks: deque[float] = deque()
        self.above = False
        self.until = 0.0

    def feed(self, s: Sample) -> list[Gesture]:
        t = s.t
        thr = self.ratio * self.calib.a_thr
        if s.a_mag > thr and not self.above:
            self.above = True
            self.peaks.append(t)
        elif s.a_mag < thr * 0.6:
            self.above = False
        while self.peaks and self.peaks[0] < t - self.window:
            self.peaks.popleft()
        if t >= self.until and len(self.peaks) >= self.peaks_needed:
            self.until = t + self.window
            n = len(self.peaks)
            self.peaks.clear()
            return [Gesture("shake", t, min(1.0, n / (self.peaks_needed * 2)), "x", 1, self.window, {"peaks": n})]
        return []


class FlickDetector(Detector):
    kinds = ("flick",)

    def __init__(self, cfg: dict[str, Any], calib: Calibration):
        f = cfg["flick"]
        self.max_ms = float(f["max_ms"])
        self.reversal_ms = float(f["reversal_ms"])
        self.thr = float(cfg["punch"]["a_fwd_ms2"])
        self.reset()

    def reset(self) -> None:
        self.t_start: float | None = None
        self.peak = 0.0
        self.t_end: float | None = None
        self.until = 0.0

    def feed(self, s: Sample) -> list[Gesture]:
        t = s.t
        if t < self.until:
            return []
        if self.t_start is None:
            if s.a_fwd > self.thr:
                self.t_start, self.peak, self.t_end = t, s.a_fwd, None
            return []
        if self.t_end is None:
            if s.a_fwd > self.thr:
                self.peak = max(self.peak, s.a_fwd)
                if t - self.t_start > self.max_ms:
                    self.t_start = None
            else:
                self.t_end = t
            return []
        if s.a_fwd < -0.3 * self.peak and t - self.t_end <= self.reversal_ms:
            g = Gesture("flick", self.t_start, min(1.0, self.peak / 30), "y", 1, t - self.t_start, {"peak_ms2": round(self.peak, 2)})
            self.t_start, self.until = None, t + 400
            return [g]
        if t - self.t_end > self.reversal_ms:
            self.t_start = None
        return []


class BumpDetector(Detector):
    kinds = ("bump",)

    def __init__(self, cfg: dict[str, Any], calib: Calibration):
        b = cfg["bump"]
        self.thr = float(b["a_ms2"])
        self.max_ms = float(b["max_ms"])
        self.w_max = float(b.get("w_max_dps", 80))   # a tap has little rotation; a swing has a lot
        self.reset()

    def reset(self) -> None:
        self.t_start: float | None = None
        self.peak = 0.0
        self.until = 0.0
        self.w_peak = 0.0

    def feed(self, s: Sample) -> list[Gesture]:
        t = s.t
        a = max(s.a_mag, abs(s.raw_a[0]) if s.raw_a else 0, abs(s.raw_a[1]) if s.raw_a else 0, abs(s.raw_a[2]) if s.raw_a else 0)
        if t < self.until:
            return []
        if self.t_start is None:
            if a > self.thr:
                self.t_start, self.peak, self.w_peak = t, a, s.w_mag
            return []
        if a > self.thr:
            self.peak = max(self.peak, a)
            self.w_peak = max(self.w_peak, s.w_mag)
            if t - self.t_start > self.max_ms:
                self.t_start = None  # too long: a swing, not a bump
            return []
        if self.w_peak > self.w_max:
            self.t_start = None      # rotating hard: a swing or punch, not a tap
            return []
        g = Gesture("bump", self.t_start, min(1.0, self.peak / 40), "z", 1, t - self.t_start, {"peak_ms2": round(self.peak, 1)})
        self.t_start, self.until = None, t + 300
        return [g]


class DetectorSet:
    """The detectors active for a sport. Feed one sample, get zero or more gestures."""

    def __init__(self, cfg: dict[str, Any], calib: Calibration, sport: str = "idle"):
        self.sport = sport
        d: list[Detector] = []
        if sport == "bowling":
            d = [SwingDetector(cfg, calib, "bowling", release=True), BumpDetector(cfg, calib)]
        elif sport == "baseball":
            d = [SwingDetector(cfg, calib, "baseball"), BumpDetector(cfg, calib)]
        elif sport == "boxing":
            d = [PunchDetector(cfg, calib), BlockDetector(cfg, calib), DodgeDetector(cfg, calib), BumpDetector(cfg, calib)]
        elif sport == "all":
            d = [SwingDetector(cfg, calib, "default", release=True), PunchDetector(cfg, calib), BlockDetector(cfg, calib),
                 DodgeDetector(cfg, calib), ShakeDetector(cfg, calib), FlickDetector(cfg, calib), BumpDetector(cfg, calib)]
        else:
            d = [ShakeDetector(cfg, calib), FlickDetector(cfg, calib), BumpDetector(cfg, calib)]
        self.detectors = d

    @classmethod
    def for_sport(cls, cfg: dict[str, Any], calib: Calibration, sport: str) -> "DetectorSet":
        return cls(cfg, calib, sport)

    def feed(self, s: Sample) -> list[Gesture]:
        out: list[Gesture] = []
        for d in self.detectors:
            out.extend(d.feed(s))
        return out

    def reset(self) -> None:
        for d in self.detectors:
            d.reset()
