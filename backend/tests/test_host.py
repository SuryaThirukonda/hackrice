"""Host module: set_param (memory + YAML leaf write-back + live detector rebuild), reload_config, telemetry,
diagnostics enrichment, edge Worker backend-url admin."""
from __future__ import annotations

import shutil

import httpx
import yaml

from app.config import CONFIG_DIR
from tests.conftest import run_for


def _tmp_config(host, tmp_path):
    d = tmp_path / "config"
    d.mkdir()
    for name in ("motion", "tiers", "market", "voice"):
        shutil.copy(CONFIG_DIR / f"{name}.yaml", d / f"{name}.yaml")
    host.config_dir = d
    return d


def test_host_gets_config_on_hello_and_set_param_writes_back(arena, clock, make_client, tmp_path):
    host = arena.modules["host"]
    d = _tmp_config(host, tmp_path)
    h = make_client("host")
    cfg = h.last("host.config").d
    assert cfg["config"]["motion"]["swing"]["omega_arm_dps"] == 90 and "bowling" in cfg["tiers"] and "demo" in cfg["scenarios"]["bowling"]
    # a calibrated pipeline must get a rebuilt detector set with the new constant
    motion = arena.modules["motion.worker"]
    p = motion.pipeline("phone-1"); p.calibrator.calib.done = True; p.set_sport("bowling")
    assert p.detectors is not None and p.detectors.detectors[0].omega_arm == 90.0
    arena.config.set_path("market.windows.betting_s", 0.4)         # simulate HAP_FAST_TIMERS living only in memory
    h.send("host.set_param", {"path": "motion.swing.omega_arm_dps", "value": 120}); arena.step()
    ack = h.last("host.ack").d
    assert ack["cmd"] == "set_param" and ack["ok"] and ack["persisted"] and ack["old"] == 90
    assert arena.config.get("motion.swing.omega_arm_dps") == 120
    assert p.detectors.detectors[0].omega_arm == 120.0
    assert yaml.safe_load((d / "motion.yaml").read_text())["swing"]["omega_arm_dps"] == 120
    assert yaml.safe_load((d / "market.yaml").read_text())["windows"]["betting_s"] == 12, "in-memory overrides must not leak to disk"
    assert h.last("host.config").d["config"]["motion"]["swing"]["omega_arm_dps"] == 120
    # list index paths (tiers) and int/float coercion
    h.send("host.set_param", {"path": "tiers.bowling.tiers.0.params.lane_sigma", "value": 0.5}); arena.step()
    assert arena.config.tier("bowling", "rookie")["params"]["lane_sigma"] == 0.5
    assert yaml.safe_load((d / "tiers.yaml").read_text())["bowling"]["tiers"][0]["params"]["lane_sigma"] == 0.5
    h.send("host.set_param", {"path": "nope.x", "value": 1}); arena.step()
    assert h.last("host.ack").d["ok"] is False
    h.send("host.set_param", {"path": "market.windows.between_s", "value": 3, "persist": False}); arena.step()
    assert arena.config.get("market.windows.between_s") == 3 and yaml.safe_load((d / "market.yaml").read_text())["windows"]["between_s"] == 2


def test_reload_config_rereads_disk_in_place(arena, clock, make_client, tmp_path):
    host = arena.modules["host"]
    d = _tmp_config(host, tmp_path)
    h = make_client("host")
    motion_cfg = arena.modules["motion.worker"].cfg
    arena.config.set_path("motion.swing.a_sat_ms2", 99)
    (d / "motion.yaml").write_text((d / "motion.yaml").read_text().replace("a_sat_ms2: 35", "a_sat_ms2: 40"))
    h.send("host.reload_config"); arena.step()
    assert h.last("host.ack").d == {"cmd": "reload_config", "ok": True}
    assert arena.config.get("motion.swing.a_sat_ms2") == 40
    assert motion_cfg is arena.modules["motion.worker"].cfg and motion_cfg["swing"]["a_sat_ms2"] == 40, "section dicts must be updated in place"
    assert arena.config.get("game.bowling.quick_frames") == 5


def test_telemetry_and_diagnostics(arena, clock, make_client):
    h = make_client("host")
    proj = make_client("projector")
    proj.send("host.telemetry", {"frame_ms_p95": 17.2, "fps": 59, "frames": 295}); arena.step()
    run_for(arena, clock, 1.2)
    diag = [e.d for e in h.of("host.diagnostics") if "arena" in e.d]
    assert diag, "host.diagnostics enrichment missing"
    d = diag[-1]
    assert d["telemetry"]["frame_ms_p95"] == 17.2 and d["telemetry"]["role"] == "projector"
    assert {s["role"] for s in d["sockets"]} == {"host", "projector"}
    assert all({"queued", "dropped", "seq"} <= set(s) for s in d["sockets"])
    assert "tick_p95_ms" in d["arena"] and d["arena"]["connections"] == 2 and d["arena"]["match"] is None
    h.send("host.toggle", {"persona": False}); arena.step()
    assert h.last("host.ack").d["toggles"]["persona"] is False


def test_set_backend_url_posts_to_worker(arena, make_client):
    host = arena.modules["host"]
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url); seen["key"] = request.headers.get("x-admin-key"); seen["method"] = request.method
        return httpx.Response(200, json={"ok": True, "backend_url": request.url.params.get("url")})
    host.http_transport = httpx.MockTransport(handler)
    h = make_client("host")
    h.send("host.set_backend_url", {"worker_url": "https://hap.example.workers.dev/", "admin_key": "k1", "url": "https://abc.trycloudflare.com"}); arena.step(); arena.step()
    ack = h.last("host.ack").d
    assert ack["cmd"] == "set_backend_url" and ack["ok"] and ack["status"] == 200
    assert seen == {"url": "https://hap.example.workers.dev/backend/set?url=https%3A%2F%2Fabc.trycloudflare.com", "key": "k1", "method": "POST"}
    h.send("host.set_backend_url", {"worker_url": "nope", "admin_key": "k1", "url": "https://abc.trycloudflare.com"}); arena.step()
    assert h.last("host.ack").d["ok"] is False
