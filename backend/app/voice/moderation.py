"""Line moderation: blocklist, length cap, strip display names that are not the speaker's."""
from __future__ import annotations

import re


def moderate(text: str, max_chars: int = 90, blocklist: list[str] | None = None, protected_names: list[str] | None = None) -> str | None:
    if not text:
        return None
    t = " ".join(text.split())
    low = t.lower()
    for bad in blocklist or []:
        if bad and bad.lower() in low:
            return None
    for name in protected_names or []:
        if name and len(name) > 2:
            t = re.sub(re.escape(name), "you", t, flags=re.I)
    if len(t) > max_chars:
        cut = t[:max_chars]
        t = cut[: cut.rfind(" ")] if " " in cut else cut
        t = t.rstrip(",;:-") + "…"
    return t
