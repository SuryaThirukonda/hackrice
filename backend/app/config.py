"""Configuration: loads backend/config/*.yaml into one Config object plus env knobs.

Reload with Config.load(); patch at runtime with config.set_path("swing.a_sat_ms2", 30).
"""
from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
BACKEND_DIR = CONFIG_DIR.parent
load_dotenv(BACKEND_DIR / ".env")

FAST_TIMER_OVERRIDES: dict[str, Any] = {
    "market.windows.betting_s": 0.4,
    "market.windows.between_s": 0.2,
    "market.windows.resolving_s": 0.3,
    "market.card.vote_s": 1.0,
    "market.card.idle_start_s": 2.0,
    "market.sponsor.crate_bid_s": 1.0,
    "market.sponsor.warn_s": 0.2,
    "motion.calib.rest_seconds": 0.5,
    "motion.calib.raise_seconds": 0.3,
    "motion.calib.rate_check_seconds": 0.5,
    "game.boxing.round_s": 6,
    "game.boxing.rest_s": 1,
    "game.boxing.down_s": 0.6,
    "game.baseball.pitch_gap_s": 0.8,
    "game.baseball.at_bat_window_s": 20,
}

GAME_DEFAULTS: dict[str, Any] = {
    "bowling": {"quick_frames": 5, "k_hook": 0.8, "gutter": 0.92, "pocket": 0.28, "roll_animation_s": 2.5, "input_window_s": 20},
    "baseball": {"innings": 3, "outs_per_half": 3, "at_bat_window_s": 45, "pitch_gap_s": 2.5, "pitches": {
        "fastball": {"travel_ms": 900, "brk": 0.0, "height": 0.5},
        "changeup": {"travel_ms": 1250, "brk": 0.0, "height": 0.5},
        "curve": {"travel_ms": 1100, "brk": -0.4, "height": 0.4},
        "high": {"travel_ms": 950, "brk": 0.0, "height": 0.85},
        "low": {"travel_ms": 950, "brk": 0.0, "height": 0.15},
        "inside": {"travel_ms": 950, "brk": 0.2, "height": 0.5},
        "outside": {"travel_ms": 950, "brk": -0.2, "height": 0.5},
        "knuckle": {"travel_ms": 1050, "brk": 0.0, "height": 0.5, "late_break": 1},
    }},
    "boxing": {"tick_ms": 50, "card_tick_ms": 80, "round_s": 30, "rounds": 3, "rest_s": 3, "down_s": 3.0,
               "hp": 100, "stamina": 100, "jab_dmg": 8, "power_dmg": 10, "hook_mult": 1.4,
               "jab_stamina": 10, "hook_stamina": 16, "block_mult": 0.2, "regen_idle": 4, "regen_block": 8,
               "dodge_window_ms": 300, "knockdown_at": [50, 0]},
}


def _get(d: dict, path: str, default=None):
    cur: Any = d
    for k in path.split("."):
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur


def _set(d: dict, path: str, value) -> None:
    keys = path.split(".")
    cur = d
    for k in keys[:-1]:
        cur = cur.setdefault(k, {})
    cur[keys[-1]] = value


class Config:
    """Plain dict-backed config with dotted-path access. Kept untyped on purpose: every tunable is host-editable."""

    def __init__(self, data: dict[str, Any]):
        self.data = data
        self.mode = os.environ.get("HAP_MODE", "normal")
        self.fast_timers = os.environ.get("HAP_FAST_TIMERS", "0") == "1"
        self.dev = os.environ.get("HAP_DEV", "1") == "1"
        self.public_url = os.environ.get("HAP_PUBLIC_URL", "http://localhost:5173")
        self.openai_key = os.environ.get("OPENAI_KEY") or os.environ.get("OPENAI_API_KEY") or None
        self.elevenlabs_key = os.environ.get("ELEVENLABS_API_KEY") or None
        if self.fast_timers:
            for path, v in FAST_TIMER_OVERRIDES.items():
                _set(self.data, path, v)

    @classmethod
    def load(cls, config_dir: Path = CONFIG_DIR) -> "Config":
        data: dict[str, Any] = {"game": copy.deepcopy(GAME_DEFAULTS)}
        for name in ("motion", "tiers", "market", "voice"):
            with open(config_dir / f"{name}.yaml") as f:
                data[name] = yaml.safe_load(f) or {}
        return cls(data)

    def get(self, path: str, default=None):
        return _get(self.data, path, default)

    def set_path(self, path: str, value) -> None:
        _set(self.data, path, value)

    def section(self, name: str) -> dict[str, Any]:
        return self.data.get(name, {})

    @property
    def offline(self) -> bool:
        return self.mode == "offline"

    @property
    def persona_enabled(self) -> bool:
        return not self.offline and self.openai_key is not None

    @property
    def tts_enabled(self) -> bool:
        return not self.offline and self.elevenlabs_key is not None

    def tier(self, sport: str, tier_id: str) -> dict[str, Any]:
        for t in self.get(f"tiers.{sport}.tiers", []):
            if t["id"] == tier_id:
                return copy.deepcopy(t)
        raise KeyError(f"no tier {tier_id} for {sport}")

    def tiers(self, sport: str) -> list[dict[str, Any]]:
        return copy.deepcopy(self.get(f"tiers.{sport}.tiers", []))

    def write_back(self, config_dir: Path = CONFIG_DIR) -> None:
        for name in ("motion", "tiers", "market", "voice"):
            with open(config_dir / f"{name}.yaml", "w") as f:
                yaml.safe_dump(self.data[name], f, sort_keys=False, allow_unicode=True)
