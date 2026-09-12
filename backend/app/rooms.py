"""Rooms: devices, seats, single-use seat tokens, join URLs, welcome/snapshot/resync, pings, disconnects."""
from __future__ import annotations

import secrets
from typing import Any

from .arena import ArenaLoop, Intent
from .clock import OffsetEstimator
from .state import ArenaState, Device, Seat

SEAT_SETS: dict[str, list[tuple[str, str, dict[str, Any]]]] = {
    "single": [("P1", "Player 1", {})],
    "two_glove": [("L", "Left glove", {"hand": "L"}), ("R", "Right glove", {"hand": "R"})],
    "head_to_head": [("A", "Side A", {"side": "A"}), ("B", "Side B", {"side": "B"})],
    "tag_team": [("ACTIVE", "Active", {"side": "active"}), ("BENCH", "Bench", {"side": "bench"})],
    "none": [],
}


def new_token() -> str:
    return secrets.token_urlsafe(12)


class Rooms:
    def __init__(self, loop: ArenaLoop, state: ArenaState, config):
        self.loop, self.state, self.config = loop, state, config
        self.offsets: dict[str, OffsetEstimator] = {}
        self.on_join: list = []        # callbacks(device) for ledger grants etc.
        self.on_seat_change: list = [] # callbacks(seat, event) event in claimed|released
        loop.on("session.hello", self.handle_hello)
        loop.on("session.ping", self.handle_ping)
        loop.on("session.resync", self.handle_resync)
        loop.on("session.nickname", self.handle_nickname)
        loop.on("session.disconnect", self.handle_disconnect)
        loop.on("host.release_seat", lambda i: self.release_seat(i.d.get("seat_id", "")))
        loop.on("host.lock_seat", lambda i: self.lock_seat(i.d.get("seat_id", ""), bool(i.d.get("locked", True))))
        loop.on("host.set_public_url", self.handle_set_public_url)
        loop.on("host.set_seats", lambda i: self.configure_seats(i.d.get("mode", "single")))
        loop.on("host.kick", self.handle_kick)

    # ---- seats -----------------------------------------------------------
    def configure_seats(self, mode: str = "single") -> None:
        for s in list(self.state.seats.values()):
            if s.status == "claimed":
                self._unbind(s)
        self.state.seats = {}
        for seat_id, label, extra in SEAT_SETS.get(mode, SEAT_SETS["single"]):
            self.state.seats[seat_id] = Seat(seat_id=seat_id, label=label, token=new_token(), **extra)
        self.emit_seats()

    def emit_seats(self) -> None:
        self.loop.emit("seat.update", {"seats": self.state.seats_public(), "rail_url": self.state.rail_url()})

    def seat_by_token(self, token: str | None) -> Seat | None:
        if not token:
            return None
        for s in self.state.seats.values():
            if s.token == token:
                return s
        return None

    def seat_of_device(self, device_id: str) -> Seat | None:
        for s in self.state.seats.values():
            if s.status == "claimed" and s.device_id == device_id:
                return s
        return None

    def claimed_seats(self) -> list[Seat]:
        return [s for s in self.state.seats.values() if s.status == "claimed"]

    def release_seat(self, seat_id: str) -> None:
        s = self.state.seats.get(seat_id)
        if not s:
            return
        self._unbind(s)
        s.status = "open"
        s.token = new_token()
        self.loop.cancel(f"seat_release:{seat_id}")
        self.emit_seats()
        for cb in self.on_seat_change:
            cb(s, "released")

    def lock_seat(self, seat_id: str, locked: bool) -> None:
        s = self.state.seats.get(seat_id)
        if not s:
            return
        if locked and s.status == "open":
            s.status = "locked"
        elif not locked and s.status == "locked":
            s.status = "open"
            s.token = new_token()
        self.emit_seats()

    def _unbind(self, s: Seat) -> None:
        if s.device_id and s.device_id in self.state.devices:
            dev = self.state.devices[s.device_id]
            if dev.seat_id == s.seat_id:
                dev.seat_id = None
                dev.calibrated = False
                self.loop.emit("session.welcome", self._welcome(dev, seat=None, reason="released"), to=("device", dev.device_id))
        s.device_id, s.nickname, s.claimed_ts = None, None, 0.0

    # ---- hello -------------------------------------------------------------
    def handle_hello(self, i: Intent) -> None:
        d = i.d
        now = self.loop.clock.now()
        dev = self.state.devices.get(d["device_id"])
        if dev is None:
            dev = Device(device_id=d["device_id"], role=d["role"], first_seen=now)
            self.state.devices[dev.device_id] = dev
            self.offsets[dev.device_id] = OffsetEstimator()
            new = True
        else:
            new = False
        dev.role = d["role"]
        dev.connected = True
        dev.last_seen = now
        dev.ua = d.get("ua") or dev.ua
        if d.get("nickname"):
            dev.nickname = d["nickname"][:24]
        if i.conn_id:
            dev.conn_ids.add(i.conn_id)
            conn = self.loop.conns.get(i.conn_id)
            if conn:
                conn.device_id, conn.role = dev.device_id, dev.role

        seat: Seat | None = None
        reason: str | None = None
        if dev.role == "remote":
            seat = self.seat_by_token(d.get("token")) or self.seat_of_device(dev.device_id)
            if seat is None:
                reason = "taken"
            elif seat.status == "claimed" and seat.device_id == dev.device_id:
                pass  # same phone reconnecting (rotated private token, or the stale QR URL after a refresh)
            elif seat.status == "open":
                self._claim(seat, dev)
            else:
                seat, reason = None, "taken"
            if seat is None:
                dev.seat_id = None
        if new or dev.role == "rail":
            for cb in self.on_join:
                cb(dev)
        self.loop.emit("session.welcome", self._welcome(dev, seat, reason), to=("conn", i.conn_id) if i.conn_id else ("device", dev.device_id))
        self.loop.emit("session.snapshot", self.state.snapshot(dev.role, dev.device_id), to=("conn", i.conn_id) if i.conn_id else ("device", dev.device_id))
        if dev.role in ("projector", "host"):
            self.emit_seats()

    def _claim(self, seat: Seat, dev: Device) -> None:
        seat.status = "claimed"
        seat.device_id = dev.device_id
        seat.nickname = dev.nickname
        seat.claimed_ts = self.loop.clock.now()
        seat.token = new_token()  # rotate: the QR that was scanned is now dead; the device receives the new one privately
        dev.seat_id = seat.seat_id
        dev.calibrated = False
        self.emit_seats()
        self._arm_release(seat)
        for cb in self.on_seat_change:
            cb(seat, "claimed")

    def _arm_release(self, seat: Seat) -> None:
        secs = float(self.config.get("motion.unclaimed_release_s", 20))
        self.loop.schedule_in(secs, lambda: self._check_release(seat.seat_id), key=f"seat_release:{seat.seat_id}")

    def _check_release(self, seat_id: str) -> None:
        s = self.state.seats.get(seat_id)
        if not s or s.status != "claimed" or not s.device_id:
            return
        dev = self.state.devices.get(s.device_id)
        gap = self.loop.clock.now() - max(s.last_frame_ts, s.claimed_ts)
        limit = self.config.get("motion.unclaimed_release_s", 20) - 0.01
        if dev is None or (not dev.connected and gap > limit) or (dev.connected and not dev.calibrated and gap > limit):
            self.release_seat(seat_id)
        else:
            self._arm_release(s)

    def _welcome(self, dev: Device, seat: Seat | None, reason: str | None) -> dict[str, Any]:
        return {
            "device_id": dev.device_id, "role": dev.role, "nickname": dev.nickname,
            "seat_id": seat.seat_id if seat else None, "seat_token": seat.token if seat else None,
            "seat_label": seat.label if seat else None, "hand": seat.hand if seat else None,
            "reason": reason, "public_url": self.state.public_url, "rail_url": self.state.rail_url(),
            "server_ts": self.loop.clock.now_ms(), "mode": self.config.mode, "dev": self.config.dev,
            "balance": self.state.balances.get(dev.device_id, 0),
        }

    # ---- misc session ------------------------------------------------------
    def handle_ping(self, i: Intent) -> None:
        now_ms = self.loop.clock.now_ms()
        if i.device_id and i.device_id in self.offsets:
            off = self.offsets[i.device_id].add(i.d["t_client"], now_ms, i.d.get("rtt_ms", 0.0))
            self.state.devices[i.device_id].offset_ms = off
            self.state.devices[i.device_id].last_seen = self.loop.clock.now()
        self.loop.emit("session.pong", {"t_client": i.d["t_client"], "t_server": now_ms}, to=("conn", i.conn_id) if i.conn_id else ("device", i.device_id))

    def offset_ms(self, device_id: str) -> float:
        est = self.offsets.get(device_id)
        return est.offset_ms if est else 0.0

    def handle_resync(self, i: Intent) -> None:
        role = i.role or (self.state.devices[i.device_id].role if i.device_id in self.state.devices else "rail")
        self.loop.emit("session.snapshot", self.state.snapshot(role, i.device_id), to=("conn", i.conn_id) if i.conn_id else ("device", i.device_id))

    def handle_nickname(self, i: Intent) -> None:
        dev = self.state.devices.get(i.device_id or "")
        if not dev:
            return
        dev.nickname = i.d["nickname"][:24]
        if dev.seat_id and dev.seat_id in self.state.seats:
            self.state.seats[dev.seat_id].nickname = dev.nickname
            self.emit_seats()
        self.loop.emit("session.welcome", self._welcome(dev, self.state.seats.get(dev.seat_id or ""), None), to=("device", dev.device_id))

    def handle_disconnect(self, i: Intent) -> None:
        dev = self.state.devices.get(i.device_id or "")
        if not dev:
            return
        if i.conn_id:
            dev.conn_ids.discard(i.conn_id)
        if not dev.conn_ids:
            dev.connected = False
            dev.last_seen = self.loop.clock.now()
            if dev.seat_id and dev.seat_id in self.state.seats:
                self._arm_release(self.state.seats[dev.seat_id])
                self.loop.emit("motion.status", {"device_id": dev.device_id, "seat_id": dev.seat_id, "connected": False}, to=["projector", "host"])

    def handle_set_public_url(self, i: Intent) -> None:
        url = str(i.d.get("url", "")).strip().rstrip("/")
        if url.startswith("http"):
            self.state.public_url = url
            self.emit_seats()
            self.loop.emit("host.ack", {"cmd": "set_public_url", "ok": True, "url": url}, to="host")

    def handle_kick(self, i: Intent) -> None:
        dev = self.state.devices.get(i.d.get("device_id", ""))
        if not dev:
            return
        if dev.seat_id:
            self.release_seat(dev.seat_id)
        self.loop.emit("session.error", {"reason": "kicked"}, to=("device", dev.device_id))
        dev.connected = False

    def touch_frame(self, device_id: str, ts: float) -> None:
        dev = self.state.devices.get(device_id)
        if dev:
            dev.last_frame_ts = ts
            if dev.seat_id and dev.seat_id in self.state.seats:
                self.state.seats[dev.seat_id].last_frame_ts = ts
