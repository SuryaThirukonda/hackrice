"""Host module: config hot reload and write-back, projector telemetry, arena diagnostics, edge Worker admin.

The other host.* commands live next to the state they touch (rooms: seats/public_url/kick; games: start/pause/next/
force_scenario/card; motion: toggle; voice: unlock_audio; market: adjust_chips). This module owns:

  host.set_param {path, value, persist?}  patch config in memory (dotted path, list indexes allowed:
                                          tiers.bowling.tiers.0.params.lane_sigma), rebuild live detector sets when a
                                          motion.* value changes, write the one changed leaf back to its YAML file
  host.reload_config                      re-read backend/config/*.yaml into the live Config object (in place, so every
                                          module holding a section dict sees the new values)
  host.telemetry {frame_ms_p95, fps,...}  projector frame stats, kept for host.diagnostics
  host.set_backend_url {url, admin_key, worker_url}  POST the laptop's tunnel URL to the Cloudflare Worker (cf/README.md)
  host.config                             emitted to a host on hello and after every change
  host.diagnostics {arena, sockets, telemetry}  every second: per-connection queue depth and drops, timer jitter p95,
                                          current match/phase, market counts
"""
from __future__ import annotations

import asyncio
import logging
import statistics
import time
from pathlib import Path
from typing import Any

import yaml

from .arena import Intent
from .config import CONFIG_DIR, Config

log = logging.getLogger("hap.host")

PERSISTED_SECTIONS = ("motion", "tiers", "market", "voice")
SEAT_MODES = ("single", "two_glove", "head_to_head", "tag_team", "none")


def _seg(k: str) -> str | int:
    return int(k) if k.isdigit() else k


def get_path(data: Any, path: str, default=None):
    cur = data
    for k in path.split("."):
        key = _seg(k)
        try:
            cur = cur[key]
        except (KeyError, IndexError, TypeError):
            return default
    return cur


def set_path(data: Any, path: str, value) -> None:
    """Like config._set but walks into lists by integer index. Creates intermediate dicts, never lists."""
    keys = [_seg(k) for k in path.split(".")]
    cur = data
    for k in keys[:-1]:
        if isinstance(cur, list):
            cur = cur[k]  # type: ignore[index]
        else:
            if k not in cur or not isinstance(cur[k], (dict, list)):
                cur[k] = {}
            cur = cur[k]
    last = keys[-1]
    cur[last] = value  # type: ignore[index]


def numeric_leaves(data: Any, prefix: str = "", out: list[tuple[str, Any]] | None = None) -> list[tuple[str, Any]]:
    out = [] if out is None else out
    if isinstance(data, dict):
        for k, v in data.items():
            numeric_leaves(v, f"{prefix}.{k}" if prefix else str(k), out)
    elif isinstance(data, list):
        for i, v in enumerate(data):
            numeric_leaves(v, f"{prefix}.{i}" if prefix else str(i), out)
    elif isinstance(data, (int, float)) and not isinstance(data, bool):
        out.append((prefix, data))
    return out


class HostModule:
    def __init__(self, arena):
        self.arena = arena
        self.loop, self.state, self.config = arena.loop, arena.state, arena.config
        self.config_dir: Path = Path(getattr(arena.config, "config_dir", CONFIG_DIR))
        self.telemetry: dict[str, Any] = {}
        self.telemetry_ts: float = 0.0
        self.changes: list[dict[str, Any]] = []
        self._probe_last: float | None = None
        self._jitter_ms: list[float] = []
        self.http_transport = None          # tests inject an httpx.MockTransport
        self.last_backend_result: dict[str, Any] | None = None
        self.loop.on("host.set_param", self.on_set_param)
        self.loop.on("host.reload_config", self.on_reload_config)
        self.loop.on("host.telemetry", self.on_telemetry)
        self.loop.on("host.set_backend_url", self.on_set_backend_url)
        self.loop.on("host.backend_result", self.on_backend_result)
        self.loop.on("host.toggle", self.on_toggle_after)      # motion.worker flips the flag first; we tell the host page
        self.loop.on("session.hello", self.on_hello)            # rooms welcomes first, then we push host.config
        self.loop.schedule_every(0.05, self._probe, key="host.probe")
        self.loop.schedule_every(1.0, self.emit_diagnostics, key="host.diagnostics")

    # ---- config ------------------------------------------------------------------------------------------------
    def config_payload(self) -> dict[str, Any]:
        from .games import scripted
        sports = ("bowling", "baseball", "boxing")
        return {
            "config": self.config.data,
            "sections": sorted(self.config.data.keys()),
            "persisted_sections": list(PERSISTED_SECTIONS),
            "scenarios": {s: ["demo"] + sorted(k for k in scripted.SCENARIOS.get(s, {}) if k != "demo") for s in sports},
            "tiers": {s: [{"id": t["id"], "name": t["name"]} for t in self.config.tiers(s)] for s in sports},
            "seat_modes": list(SEAT_MODES),
            "mode": self.config.mode, "fast_timers": self.config.fast_timers, "dev": self.config.dev,
            "config_dir": str(self.config_dir), "changes": self.changes[-20:],
        }

    def emit_config(self, to: Any = "host") -> None:
        self.loop.emit("host.config", self.config_payload(), to=to)

    def on_hello(self, i: Intent) -> None:
        if i.d.get("role") == "host":
            self.emit_config(to=("conn", i.conn_id) if i.conn_id else "host")

    def on_set_param(self, i: Intent) -> None:
        path = str(i.d.get("path", "")).strip()
        value = i.d.get("value")
        persist = bool(i.d.get("persist", True))
        section = path.split(".")[0] if path else ""
        if not path or section not in self.config.data or value is None:
            self.loop.emit("host.ack", {"cmd": "set_param", "ok": False, "path": path, "reason": "unknown path"}, to="host")
            return
        old = get_path(self.config.data, path)
        if isinstance(old, bool):
            value = bool(value)
        elif isinstance(old, int) and not isinstance(value, bool) and isinstance(value, (int, float)) and float(value).is_integer():
            value = int(value)
        elif isinstance(old, float) and isinstance(value, (int, float)):
            value = float(value)
        try:
            set_path(self.config.data, path, value)
        except (KeyError, IndexError, TypeError) as e:
            self.loop.emit("host.ack", {"cmd": "set_param", "ok": False, "path": path, "reason": f"bad path: {e}"}, to="host")
            return
        persisted = False
        if persist and section in PERSISTED_SECTIONS:
            try:
                persisted = self._write_back_leaf(path, value)
            except Exception as e:  # noqa: BLE001
                log.exception("write-back failed")
                self.loop.emit("host.ack", {"cmd": "set_param", "ok": False, "path": path, "reason": f"write-back failed: {e}"}, to="host")
        self._push_live(section)
        self.changes.append({"path": path, "old": old, "value": value, "ts": self.loop.clock.now_ms(), "persisted": persisted})
        self.loop.emit("host.ack", {"cmd": "set_param", "ok": True, "path": path, "value": value, "old": old, "persisted": persisted}, to="host")
        self.emit_config()

    def _write_back_leaf(self, path: str, value) -> bool:
        """Write one leaf into its YAML file. Reads the file fresh so in-memory overrides (HAP_FAST_TIMERS) never leak to disk."""
        section, rest = path.split(".", 1) if "." in path else (path, "")
        f = self.config_dir / f"{section}.yaml"
        if not f.exists():
            return False
        data = yaml.safe_load(f.read_text()) or {}
        if rest:
            set_path(data, rest, value)
        else:
            data = value
        f.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True))
        return True

    def _push_live(self, section: str) -> None:
        """Modules that copy constants at construction time get rebuilt; everything else reads config at use time."""
        if section == "motion":
            motion = self.arena.modules.get("motion.worker")
            if motion:
                from .motion.detectors import DetectorSet
                for p in motion.pipelines.values():
                    if p.calibrated:
                        p.detectors = DetectorSet.for_sport(p.cfg, p.calibrator.calib, p.sport)
        # market.windows.* and game.* are read through config.get at use time; tiers.* apply at the next match start.

    def on_reload_config(self, i: Intent) -> None:
        try:
            fresh = Config.load(self.config_dir) if (self.config_dir / "motion.yaml").exists() else Config.load()
        except Exception as e:  # noqa: BLE001
            log.exception("reload failed")
            self.loop.emit("host.ack", {"cmd": "reload_config", "ok": False, "reason": str(e)}, to="host")
            return
        for name, section in fresh.data.items():
            live = self.config.data.get(name)
            if isinstance(live, dict) and isinstance(section, dict):
                live.clear(); live.update(section)       # in place: motion.worker holds config.data["motion"] by reference
            else:
                self.config.data[name] = section
        for name in list(self.config.data):
            if name not in fresh.data:
                self.config.data.pop(name)
        for name in PERSISTED_SECTIONS:
            self._push_live(name)
        self.changes.append({"path": "*", "value": "reload", "ts": self.loop.clock.now_ms(), "persisted": False})
        self.loop.emit("host.ack", {"cmd": "reload_config", "ok": True}, to="host")
        self.emit_config()

    def on_toggle_after(self, i: Intent) -> None:
        self.loop.emit("host.ack", {"cmd": "toggle", "ok": True, "toggles": dict(self.state.toggles)}, to="host")

    # ---- telemetry & diagnostics -------------------------------------------------------------------------------
    def on_telemetry(self, i: Intent) -> None:
        self.telemetry = {k: v for k, v in i.d.items() if isinstance(v, (int, float, str, bool)) or v is None}
        self.telemetry["device_id"] = i.device_id
        self.telemetry["role"] = i.role
        self.telemetry_ts = self.loop.clock.now()

    def _probe(self) -> None:
        now = time.perf_counter()
        if self._probe_last is not None:
            self._jitter_ms.append(abs((now - self._probe_last) - 0.05) * 1000)
            if len(self._jitter_ms) > 200:
                del self._jitter_ms[:-200]
        self._probe_last = now

    def tick_stats(self) -> dict[str, float]:
        xs = sorted(self._jitter_ms)
        if not xs:
            return {"tick_p95_ms": 0.0, "tick_max_ms": 0.0, "tick_mean_ms": 0.0, "samples": 0}
        return {"tick_p95_ms": round(xs[min(len(xs) - 1, int(0.95 * len(xs)))], 2), "tick_max_ms": round(xs[-1], 2),
                "tick_mean_ms": round(statistics.fmean(xs), 2), "samples": len(xs)}

    def diagnostics_payload(self) -> dict[str, Any]:
        games = self.arena.modules.get("games.wiring")
        market = self.arena.modules.get("market.wiring")
        m = games.match if games else None
        counts: dict[str, int] = {}
        if market:
            for mk in market.book.markets.values():
                counts[mk.status] = counts.get(mk.status, 0) + 1
        sockets = [{"conn_id": c.conn_id, "role": c.role, "device_id": c.device_id,
                    "nickname": (self.state.devices[c.device_id].nickname if c.device_id in self.state.devices else None),
                    "queued": len(c.out.q), "dropped": c.out.dropped, "seq": c.out.seq}
                   for c in self.loop.conns.values()]
        arena = {
            **self.tick_stats(),
            "seq": self.loop.seq, "emitted_total": self.loop.emitted_total, "connections": len(sockets),
            "dropped_total": sum(s["dropped"] for s in sockets),
            "store_written": getattr(self.arena.store, "written", None) if self.arena.store is not None else None,
            "match": ({"match_id": m.match_id, "sport": m.sport, "tier": m.tier.id, "phase": games.phase, "turn_no": m.turn_no,
                       "paused": games.paused, "pause_reason": games.pause_reason, "ended": m.ended} if m else None),
            "markets": {"total": sum(counts.values()), **counts},
            "balances_total": sum(self.state.balances.values()),
            "mode": self.config.mode, "fast_timers": self.config.fast_timers,
            "telemetry_age_s": round(self.loop.clock.now() - self.telemetry_ts, 1) if self.telemetry_ts else None,
        }
        return {"arena": arena, "sockets": sockets, "telemetry": self.telemetry}

    def emit_diagnostics(self) -> None:
        if any(c.role == "host" for c in self.loop.conns.values()):
            self.loop.emit("host.diagnostics", self.diagnostics_payload(), to="host")

    # ---- edge Worker admin --------------------------------------------------------------------------------------
    def on_set_backend_url(self, i: Intent) -> None:
        worker = str(i.d.get("worker_url", "")).strip().rstrip("/")
        key = str(i.d.get("admin_key", ""))
        url = str(i.d.get("url", "")).strip().rstrip("/")
        if not worker.startswith("http") or not url.startswith("http"):
            self.loop.emit("host.ack", {"cmd": "set_backend_url", "ok": False, "reason": "worker_url and url must be http(s) URLs"}, to="host")
            return
        import httpx
        target = f"{worker}/backend/set"
        headers = {"x-admin-key": key}

        def result(ok: bool, status: int | None, body: str) -> dict[str, Any]:
            return {"ok": ok, "status": status, "body": body[:300], "worker_url": worker, "url": url}

        try:
            aloop = asyncio.get_running_loop()
        except RuntimeError:
            aloop = None
        if aloop is None:   # tests / headless: synchronous
            try:
                with httpx.Client(transport=self.http_transport, timeout=5.0) as c:
                    r = c.post(target, params={"url": url}, headers=headers)
                res = result(r.status_code == 200, r.status_code, r.text)
            except Exception as e:  # noqa: BLE001
                res = result(False, None, str(e))
            self.loop.submit(Intent("host.backend_result", res))
            return

        async def job():
            try:
                async with httpx.AsyncClient(transport=self.http_transport, timeout=5.0) as c:
                    r = await c.post(target, params={"url": url}, headers=headers)
                res = result(r.status_code == 200, r.status_code, r.text)
            except Exception as e:  # noqa: BLE001
                res = result(False, None, str(e))
            self.loop.submit(Intent("host.backend_result", res))
        aloop.create_task(job())

    def on_backend_result(self, i: Intent) -> None:
        self.last_backend_result = dict(i.d)
        self.loop.emit("host.ack", {"cmd": "set_backend_url", **i.d}, to="host")


def install(arena) -> HostModule:
    return HostModule(arena)
