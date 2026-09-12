"""Per-sample preprocessing: parse the 13-number wire sample, EMA low-pass, magnitudes, forward component, tilt."""
from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass
class Sample:
    t: float                      # phone ms
    a: list[float]                # linear acceleration (gravity removed), filtered
    ag: list[float]               # including gravity, raw
    w: list[float]                # rotation rate deg/s, filtered
    alpha: float
    beta: float
    gamma: float
    a_mag: float = 0.0
    w_mag: float = 0.0
    a_fwd: float = 0.0            # component along the calibrated forward axis (signed)
    w_long: float = 0.0           # rotation about the phone's long axis (y)
    raw_a: list[float] = field(default_factory=list)

    @property
    def tilt_from_vertical(self) -> float:
        return abs(abs(self.beta) - 90.0)


def parse_wire(s: list[float]) -> tuple[float, list[float], list[float], list[float], float, float, float]:
    return s[0], [s[1], s[2], s[3]], [s[4], s[5], s[6]], [s[7], s[8], s[9]], s[10], s[11], s[12]


def mag(v: list[float]) -> float:
    return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


class Preprocessor:
    """Stateful filter chain for one phone. Needs gravity (for the fallback) and forward axis from calibration."""

    def __init__(self, alpha: float = 0.5, nominal_hz: float = 60.0):
        self.alpha_nominal = alpha
        self.nominal_hz = nominal_hz
        self.alpha = alpha
        self.gravity: list[float] | None = None
        self.forward_axis = 1
        self.forward_sign = 1.0
        self.use_fallback = False   # phone reports no gravity-free acceleration
        self._a: list[float] | None = None
        self._w: list[float] | None = None

    def set_rate(self, hz: float) -> None:
        if hz > 1:
            self.alpha = min(1.0, self.alpha_nominal * (self.nominal_hz / hz) ** 0.5)

    def reset(self) -> None:
        self._a = self._w = None

    def process(self, s: list[float]) -> Sample:
        t, a, ag, w, alpha, beta, gamma = parse_wire(s)
        raw_a = list(a)
        if self.use_fallback and self.gravity is not None:
            a = [ag[i] - self.gravity[i] for i in range(3)]
        if self._a is None:
            self._a, self._w = list(a), list(w)
        else:
            k = self.alpha
            self._a = [self._a[i] + k * (a[i] - self._a[i]) for i in range(3)]
            self._w = [self._w[i] + k * (w[i] - self._w[i]) for i in range(3)]
        fa, fw = list(self._a), list(self._w)
        out = Sample(t=t, a=fa, ag=ag, w=fw, alpha=alpha, beta=beta, gamma=gamma, raw_a=raw_a)
        out.a_mag = mag(fa)
        out.w_mag = mag(fw)
        out.a_fwd = fa[self.forward_axis] * self.forward_sign
        out.w_long = fw[1]
        return out
