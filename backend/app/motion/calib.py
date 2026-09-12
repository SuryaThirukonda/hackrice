"""Calibration: rest pose (gravity, noise floor, per-phone swing threshold), forward axis from a raise, sample rate."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from .filters import mag, parse_wire


@dataclass
class Calibration:
    gravity: list[float] = field(default_factory=lambda: [0.0, 0.0, 9.81])
    a_rest_mean: float = 0.0
    a_rest_sigma: float = 0.0
    w_rest_sigma: float = 0.0
    a_thr: float = 12.0
    forward_axis: int = 1
    forward_sign: float = 1.0
    hz: float = 60.0
    use_fallback: bool = False
    done: bool = False

    def public(self) -> dict[str, Any]:
        return {"a_thr": round(self.a_thr, 2), "sigma": round(self.a_rest_sigma, 3), "hz": round(self.hz, 1),
                "forward_axis": "xyz"[self.forward_axis], "forward_sign": self.forward_sign, "fallback": self.use_fallback, "done": self.done}


class Calibrator:
    """Feed raw wire samples. Phases: rest -> raise -> done. Rate is measured continuously."""

    def __init__(self, cfg: dict[str, Any]):
        self.cfg = cfg
        self.phase = "rest"
        self.calib = Calibration()
        self._rest: list[list[float]] = []
        self._raise: list[list[float]] = []
        self._t_first: float | None = None
        self._t_last: float | None = None
        self._n = 0
        self._phase_start: float | None = None
        self.progress = 0.0

    def feed(self, s: list[float]) -> str:
        """Returns the phase after this sample."""
        t = s[0]
        if self._t_first is None:
            self._t_first = t
        self._t_last = t
        self._n += 1
        if self._n >= 10 and self._t_last > self._t_first:
            self.calib.hz = (self._n - 1) * 1000.0 / (self._t_last - self._t_first)
        if self.phase == "done":
            return self.phase
        if self._phase_start is None:
            self._phase_start = t
        elapsed = (t - self._phase_start) / 1000.0
        if self.phase == "rest":
            self._rest.append(s)
            self.progress = min(1.0, elapsed / self.cfg["rest_seconds"])
            if elapsed >= self.cfg["rest_seconds"]:
                self._finish_rest()
                self.phase, self._phase_start, self.progress = "raise", None, 0.0
        elif self.phase == "raise":
            self._raise.append(s)
            self.progress = min(1.0, elapsed / self.cfg["raise_seconds"])
            if elapsed >= self.cfg["raise_seconds"]:
                self._finish_raise()
                self.phase, self.progress = "done", 1.0
                self.calib.done = True
        return self.phase

    def _finish_rest(self) -> None:
        rows = self._rest
        n = max(1, len(rows))
        ag = [sum(parse_wire(r)[2][i] for r in rows) / n for i in range(3)]
        lin = [parse_wire(r)[1] for r in rows]
        lin_mag = [mag(v) for v in lin]
        self.calib.use_fallback = all(m == 0.0 for m in lin_mag) and n > 5
        if self.calib.use_fallback:
            lin_mag = [mag([parse_wire(r)[2][i] - ag[i] for i in range(3)]) for r in rows]
        mean = sum(lin_mag) / n
        var = sum((m - mean) ** 2 for m in lin_mag) / n
        w_mag = [mag(parse_wire(r)[3]) for r in rows]
        wm = sum(w_mag) / n
        self.calib.gravity = ag
        self.calib.a_rest_mean = mean
        self.calib.a_rest_sigma = math.sqrt(var)
        self.calib.w_rest_sigma = math.sqrt(sum((m - wm) ** 2 for m in w_mag) / n)
        self.calib.a_thr = max(float(self.cfg["min_swing_ms2"]), mean + float(self.cfg["sigma_mult"]) * self.calib.a_rest_sigma)

    def _finish_raise(self) -> None:
        rows = self._raise
        if len(rows) < 3:
            return
        g = self.calib.gravity
        # forward = the axis with the largest signed excursion of linear acceleration during the raise
        best_axis, best_val = 1, 0.0
        for i in range(3):
            if self.calib.use_fallback:
                vals = [parse_wire(r)[2][i] - g[i] for r in rows]
            else:
                vals = [parse_wire(r)[1][i] for r in rows]
            ext = max(vals, key=abs)
            if abs(ext) > abs(best_val):
                best_axis, best_val = i, ext
        if abs(best_val) > 1.0:
            self.calib.forward_axis = best_axis
            self.calib.forward_sign = 1.0 if best_val >= 0 else -1.0

    def rate_changed(self, measured_hz: float) -> bool:
        return self.calib.hz > 0 and abs(measured_hz - self.calib.hz) / self.calib.hz > float(self.cfg.get("recalib_hz_change", 0.3))
