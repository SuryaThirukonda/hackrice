"""Arena state: the single source of truth mutated only by the arena loop. snapshot(role) yields a role-scoped view."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class Device:
    device_id: str
    role: str
    nickname: str | None = None
    connected: bool = False
    seat_id: str | None = None
    ua: str | None = None
    first_seen: float = 0.0
    last_seen: float = 0.0
    last_frame_ts: float = 0.0
    hz: float = 0.0
    offset_ms: float = 0.0
    calibrated: bool = False
    last_gesture: str | None = None
    conn_ids: set[str] = field(default_factory=set)

    def public(self) -> dict[str, Any]:
        return {"device_id": self.device_id, "role": self.role, "nickname": self.nickname, "connected": self.connected,
                "seat_id": self.seat_id, "hz": round(self.hz, 1), "offset_ms": round(self.offset_ms, 1),
                "calibrated": self.calibrated, "last_gesture": self.last_gesture}


@dataclass
class Seat:
    seat_id: str
    label: str
    status: str = "open"          # open | claimed | locked
    token: str = ""
    device_id: str | None = None
    nickname: str | None = None
    hand: str | None = None       # L | R for two-glove
    side: str | None = None       # A | B for head-to-head
    claimed_ts: float = 0.0
    last_frame_ts: float = 0.0

    def public(self, public_url: str) -> dict[str, Any]:
        d = {"seat_id": self.seat_id, "label": self.label, "status": self.status, "device_id": self.device_id,
             "nickname": self.nickname, "hand": self.hand, "side": self.side}
        d["join_url"] = f"{public_url}/remote?seat={self.seat_id}&tok={self.token}" if self.status == "open" else None
        return d


@dataclass
class ArenaState:
    public_url: str = "http://localhost:5173"
    devices: dict[str, Device] = field(default_factory=dict)
    seats: dict[str, Seat] = field(default_factory=dict)
    ladder: dict[str, dict[str, Any]] = field(default_factory=dict)   # nickname -> {sport: highest tier index beaten}
    match: dict[str, Any] | None = None                                # public summary of the current match
    markets: dict[str, dict[str, Any]] = field(default_factory=dict)  # public market views
    balances: dict[str, int] = field(default_factory=dict)
    leaderboard: list[dict[str, Any]] = field(default_factory=list)
    toggles: dict[str, bool] = field(default_factory=lambda: {"persona": True, "tts": True, "record_traces": False,
                                                              "sponsor_moves": True, "card_when_idle": True})
    audio_unlocked: bool = False
    studying: dict[str, Any] = field(default_factory=dict)
    card: dict[str, Any] | None = None
    crate: dict[str, Any] | None = None
    pairing: dict[str, Any] | None = None
    pending_voice: list[dict[str, Any]] = field(default_factory=list)
    moves: list[dict[str, Any]] = field(default_factory=list)

    def rail_url(self) -> str:
        return f"{self.public_url}/rail"

    def seats_public(self) -> list[dict[str, Any]]:
        return [s.public(self.public_url) for s in self.seats.values()]

    def snapshot(self, role: str, device_id: str | None = None) -> dict[str, Any]:
        base: dict[str, Any] = {
            "public_url": self.public_url,
            "rail_url": self.rail_url(),
            "seats": self.seats_public(),
            "match": self.match,
            "markets": list(self.markets.values()),
            "leaderboard": self.leaderboard,
            "ladder": self.ladder,
            "studying": self.studying,
            "card": self.card,
            "crate": self.crate,
            "toggles": self.toggles,
            "moves": self.moves,
            "pairing": self.pairing,
        }
        if device_id is not None:
            base["me"] = {"device_id": device_id, "balance": self.balances.get(device_id, 0)}
            dev = self.devices.get(device_id)
            if dev:
                base["me"].update({"nickname": dev.nickname, "seat_id": dev.seat_id, "calibrated": dev.calibrated})
        if role in ("host", "projector"):
            base["devices"] = [d.public() for d in self.devices.values()]
        if role == "host":
            base["seat_tokens"] = {s.seat_id: s.token for s in self.seats.values()}
            base["audio_unlocked"] = self.audio_unlocked
        return base
