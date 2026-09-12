from fastapi.testclient import TestClient

from app.config import Config
from app.main import app


def test_health():
    with TestClient(app) as c:
        r = c.get("/api/health")
        assert r.status_code == 200 and r.json()["ok"] is True


def test_config_loads_all_sections():
    cfg = Config.load()
    assert cfg.get("motion.swing.omega_arm_dps") == 90
    assert cfg.get("market.starting_stack") == 500
    assert cfg.tier("boxing", "boss")["name"] == "The House Champ"
    assert len(cfg.tiers("bowling")) == 4
    assert cfg.get("game.boxing.tick_ms") == 50
