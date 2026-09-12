"""Motion module: per-device pipeline (calibrate -> preprocess -> detect) driven by motion.frame intents.
Runs inside the arena loop (single writer); CPU is negligible at 60 Hz per phone."""
from __future__ import annotations

import json
from typing import Any

from ..arena import Intent
from .calib import Calibrator
from .detectors import DetectorSet, Gesture
from .filters import Preprocessor


class Pipeline:
    def __init__(self, cfg: dict[str, Any], device_id: str, sport: str = "idle"):
        self.cfg = cfg
        self.device_id = device_id
        self.sport = sport
        self.calibrator = Calibrator(cfg["calib"])
        self.pre = Preprocessor(float(cfg.get("ema_alpha", 0.5)), float(cfg.get("nominal_hz", 60)))
        self.detectors: DetectorSet | None = None
        self.samples = 0
        self.frames = 0
        self.last_t: float | None = None
        self.hz_window: list[float] = []
        self.meter = 0.0

    @property
    def calibrated(self) -> bool:
        return self.calibrator.calib.done

    def set_sport(self, sport: str) -> None:
        if sport != self.sport or self.detectors is None:
            self.sport = sport
            if self.calibrated:
                self.detectors = DetectorSet.for_sport(self.cfg, self.calibrator.calib, sport)

    def recalibrate(self) -> None:
        self.calibrator = Calibrator(self.cfg["calib"])
        self.detectors = None
        self.pre.reset()

    def _finish_calibration(self) -> None:
        c = self.calibrator.calib
        self.pre.gravity = c.gravity
        self.pre.forward_axis, self.pre.forward_sign = c.forward_axis, c.forward_sign
        self.pre.use_fallback = c.use_fallback
        self.pre.set_rate(c.hz)
        self.pre.reset()
        self.detectors = DetectorSet.for_sport(self.cfg, c, self.sport)

    def feed_frame(self, frame: dict[str, Any]) -> list[Gesture]:
        out: list[Gesture] = []
        self.frames += 1
        for s in frame["s"]:
            out.extend(self.feed_sample(s))
        return out

    def feed_sample(self, s: list[float]) -> list[Gesture]:
        self.samples += 1
        t = s[0]
        if self.last_t is not None and t > self.last_t:
            self.hz_window.append(t - self.last_t)
            if len(self.hz_window) > 120:
                self.hz_window.pop(0)
        self.last_t = t
        if not self.calibrated:
            phase = self.calibrator.feed(s)
            if phase == "done":
                self._finish_calibration()
            return []
        self.calibrator.feed(s)  # keeps measuring hz
        ps = self.pre.process(s)
        self.meter = ps.a_mag
        if self.detectors is None:
            return []
        return self.detectors.feed(ps)

    @property
    def hz(self) -> float:
        if len(self.hz_window) < 5:
            return self.calibrator.calib.hz if self.calibrated else 0.0
        return 1000.0 / (sum(self.hz_window) / len(self.hz_window))

    def status(self) -> dict[str, Any]:
        return {"device_id": self.device_id, "sport": self.sport, "hz": round(self.hz, 1), "calibrated": self.calibrated,
                "calib_phase": self.calibrator.phase, "calib_progress": round(self.calibrator.progress, 2),
                "calib": self.calibrator.calib.public(), "samples": self.samples, "frames": self.frames}


class MotionModule:
    def __init__(self, arena):
        self.arena = arena
        self.loop, self.state, self.rooms, self.config = arena.loop, arena.state, arena.rooms, arena.config
        self.cfg = self.config.section("motion")
        self.pipelines: dict[str, Pipeline] = {}
        self.sport = "idle"
        self.gesture_handlers: list = []   # games register: fn(gesture, seat_id, device_id)
        self._last_meter: dict[str, float] = {}
        self._last_phase: dict[str, str] = {}
        self.loop.on("motion.frame", self.on_frame)
        self.loop.on("motion.calib_done", self.on_calib_done)
        self.loop.on("input.action", self.on_input_action)
        self.loop.on("host.toggle", self.on_toggle)
        self.loop.schedule_every(1.0 / float(self.cfg.get("status_hz", 2)), self.emit_status, key="motion.status")
        self.rooms.on_seat_change.append(self.on_seat_change)

    def pipeline(self, device_id: str) -> Pipeline:
        p = self.pipelines.get(device_id)
        if p is None:
            p = Pipeline(self.cfg, device_id, self.sport)
            self.pipelines[device_id] = p
        return p

    def set_sport(self, sport: str) -> None:
        self.sport = sport
        for p in self.pipelines.values():
            p.set_sport(sport)

    def on_seat_change(self, seat, event: str) -> None:
        if event == "claimed" and seat.device_id:
            self.pipeline(seat.device_id).recalibrate()
            self.state.devices[seat.device_id].calibrated = False

    def on_toggle(self, i: Intent) -> None:
        for k, v in i.d.items():
            if k in self.state.toggles:
                self.state.toggles[k] = bool(v)

    def on_calib_done(self, i: Intent) -> None:
        """Phones calibrate from data; a keyboard remote sends this to declare itself ready (no motion stream).
        Sent again after every reconnect, so it also clears a stale 'reconnecting' badge on the projector."""
        dev = self.state.devices.get(i.device_id or "")
        if not dev:
            return
        self.rooms.touch_frame(dev.device_id, self.loop.clock.now())
        if not dev.calibrated:
            dev.calibrated = True
            self.loop.emit("motion.calib", {"phase": "done", "progress": 1.0, "calib": {"keyboard": True, "done": True}}, to=("device", dev.device_id))
        self.loop.emit("motion.status", {"device_id": dev.device_id, "seat_id": dev.seat_id, "connected": True, "calibrated": True, "hz": 0, "keyboard": True}, to=["projector", "host"])

    def on_frame(self, i: Intent) -> None:
        dev_id = i.device_id
        if not dev_id or dev_id not in self.state.devices:
            return
        dev = self.state.devices[dev_id]
        now = self.loop.clock.now()
        self.rooms.touch_frame(dev_id, now)
        p = self.pipeline(dev_id)
        was_calibrated = p.calibrated
        gestures = p.feed_frame(i.d)
        dev.hz = p.hz
        if self.state.toggles.get("record_traces") and self.arena.store is not None:
            self.arena.store.write("motion_frames", {"device_id": dev_id, "t0": i.d["t0"], "samples_json": json.dumps(i.d["s"])})
        phase = p.calibrator.phase
        if not was_calibrated or phase != self._last_phase.get(dev_id):
            self._last_phase[dev_id] = phase
            self.loop.emit("motion.calib", {"phase": phase, "progress": p.calibrator.progress, "calib": p.calibrator.calib.public()}, to=("device", dev_id))
        if p.calibrated and not was_calibrated:
            dev.calibrated = True
            self.loop.emit("motion.calib", {"phase": "done", "progress": 1.0, "calib": p.calibrator.calib.public()}, to=("device", dev_id))
            self.loop.emit("motion.status", p.status() | {"seat_id": dev.seat_id, "connected": True, "offset_ms": dev.offset_ms}, to=["projector", "host"])
        offset = self.rooms.offset_ms(dev_id)
        for g in gestures:
            g.device_id, g.seat_id = dev_id, dev.seat_id
            g.t_server = g.t_phone + offset
            dev.last_gesture = g.kind if g.kind != "punch" else f"punch:{g.extra.get('type')}"
            d = g.to_dict()
            self.loop.emit("motion.gesture", d, to=["projector", "host", ("device", dev_id)])
            for h in self.gesture_handlers:
                h(g)
            if self.arena.store is not None:
                self.arena.store.write("gestures", {"match_id": self.loop.match_id, "turn_no": (self.state.match or {}).get("turn_no"),
                                                    "device_id": dev_id, "seat_id": dev.seat_id, "kind": g.kind, "t_phone": g.t_phone,
                                                    "t_server": g.t_server, "power": g.power, "axis": g.axis, "sign": g.sign,
                                                    "duration_ms": g.duration_ms, "extra_json": json.dumps(g.extra | {"recv_ms": self.loop.clock.now_ms()})})
        # live meter to the projector at meter_hz
        interval = 1.0 / float(self.cfg.get("meter_hz", 15))
        if p.calibrated and now - self._last_meter.get(dev_id, 0.0) >= interval:
            self._last_meter[dev_id] = now
            self.loop.emit("motion.meter", {"seat_id": dev.seat_id, "device_id": dev_id, "mag": round(p.meter, 2), "thr": round(p.calibrator.calib.a_thr, 2)}, to="projector")

    def on_input_action(self, i: Intent) -> None:
        """Keyboard remote: build the gesture the detectors would have produced and run the same fan-out."""
        dev = self.state.devices.get(i.device_id or "")
        if not dev:
            return
        self.rooms.touch_frame(dev.device_id, self.loop.clock.now())
        dev.calibrated = True
        kind, params = i.d["kind"], dict(i.d.get("params", {}))
        power = float(params.pop("power", 0.7))
        offset = self.rooms.offset_ms(dev.device_id)
        t_client = i.d.get("t_client")
        t_server = (float(t_client) + offset) if t_client else float(self.loop.clock.now_ms())
        g = Gesture(kind, t_phone=t_server - offset, power=power, axis="y", sign=1, duration_ms=float(params.pop("duration_ms", 80)), extra=params)
        g.device_id, g.seat_id, g.t_server = dev.device_id, dev.seat_id, t_server
        dev.last_gesture = kind if kind != "punch" else f"punch:{params.get('type', 'jab')}"
        self.loop.emit("motion.gesture", g.to_dict() | {"source": "keyboard"}, to=["projector", "host", ("device", dev.device_id)])
        for h in self.gesture_handlers:
            h(g)
        if self.arena.store is not None:   # keyboard gestures are replayable too (scripts/replay_match.py uses recv_ms)
            self.arena.store.write("gestures", {"match_id": self.loop.match_id, "turn_no": (self.state.match or {}).get("turn_no"),
                                                "device_id": dev.device_id, "seat_id": dev.seat_id, "kind": g.kind, "t_phone": g.t_phone,
                                                "t_server": g.t_server, "power": g.power, "axis": g.axis, "sign": g.sign,
                                                "duration_ms": g.duration_ms, "extra_json": json.dumps(g.extra | {"recv_ms": self.loop.clock.now_ms(), "source": "keyboard"})})

    def emit_status(self) -> None:
        rows = []
        for dev_id, p in self.pipelines.items():
            dev = self.state.devices.get(dev_id)
            if not dev:
                continue
            rows.append(p.status() | {"seat_id": dev.seat_id, "connected": dev.connected, "offset_ms": round(dev.offset_ms, 1),
                                      "last_gesture": dev.last_gesture, "nickname": dev.nickname})
        if rows:
            self.loop.emit("host.diagnostics", {"motion": rows, "devices": [d.public() for d in self.state.devices.values()]}, to="host")


def install(arena) -> MotionModule:
    return MotionModule(arena)
