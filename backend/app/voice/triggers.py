"""Engine events -> commentary triggers with priorities and templates (config/voice.yaml)."""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any


@dataclass
class Trigger:
    name: str
    priority: int
    speaker: str
    persona_line: bool
    templates: list[str]

    def render(self, data: dict[str, Any], rng: random.Random) -> str:
        tpl = rng.choice(self.templates) if self.templates else self.name
        try:
            return tpl.format(**{k: data.get(k, "") for k in _fields(tpl)})
        except (KeyError, IndexError, ValueError):
            return tpl


def _fields(tpl: str) -> list[str]:
    out, i = [], 0
    while True:
        a = tpl.find("{", i)
        if a < 0:
            return out
        b = tpl.find("}", a)
        if b < 0:
            return out
        out.append(tpl[a + 1:b])
        i = b + 1


def load_triggers(cfg: dict[str, Any]) -> dict[str, Trigger]:
    out = {}
    for name, d in (cfg.get("triggers") or {}).items():
        out[name] = Trigger(name, int(d.get("priority", 1)), str(d.get("speaker", "announcer_a")), bool(d.get("persona_line", False)), list(d.get("templates", [])))
    return out
