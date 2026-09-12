"""Seeded demo scenarios per sport. Human inputs still matter; the scenario guarantees the demo beats."""
from __future__ import annotations

from typing import Any

SCENARIOS: dict[str, dict[str, dict[str, Any]]] = {
    "bowling": {
        "demo": {"seed": 4242, "strike_frames": [1, 3], "strike_pocket_err": 0.15},
    },
    "baseball": {
        "demo": {"seed": 777, "pitches": ["fastball", "fastball", "changeup", "fastball", "curve"]},
    },
    "boxing": {
        "demo": {"seed": 1111, "script": [{"t": 2.0, "state": "telegraph"}, {"t": 6.0, "state": "telegraph"}, {"t": 12.0, "state": "telegraph", "window_ms": 900}]},
    },
}


def load(sport: str, name: str | None) -> dict[str, Any]:
    if not name:
        return {}
    return dict(SCENARIOS.get(sport, {}).get(name, {}))
