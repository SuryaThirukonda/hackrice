"""Bump-to-pair: two phones that feel a sharp spike within a small window on the server timeline are paired for the
requested action (pass a seat, transfer chips, bind as two gloves, tag a teammate). Three or more -> re-bump."""
from __future__ import annotations

from typing import Any

from ..arena import Intent


class PairingModule:
    def __init__(self, arena):
        self.arena = arena
        self.loop, self.state, self.config, self.rooms = arena.loop, arena.state, arena.config, arena.rooms
        self.market = arena.modules.get("market.wiring")
        motion = arena.modules.get("motion.worker")
        bc = self.config.get("motion.bump", {})
        self.window_ms = float(bc.get("pair_window_ms", 150))
        self.request_s = float(bc.get("request_window_s", 5))
        self.request: dict[str, Any] | None = None
        self.bumps: list[tuple[float, str]] = []
        self.loop.on("pair.request", self.on_request)
        if motion:
            motion.gesture_handlers.append(self.on_gesture)

    def on_request(self, i: Intent) -> None:
        if not i.device_id:
            return
        self.request = {"kind": i.d["kind"], "requester": i.device_id, "amount": i.d.get("amount"), "seat_id": i.d.get("seat_id"),
                        "until": self.loop.clock.now() + self.request_s}
        self.bumps = []
        self.state.pairing = {"kind": self.request["kind"], "requester": self._nick(i.device_id), "until_ts": int(self.request["until"] * 1000)}
        self.loop.emit("pair.prompt", {"kind": self.request["kind"], "text": "Bump phones now", "until_ts": int(self.request["until"] * 1000)}, to="all")
        self.loop.schedule_in(self.request_s, self.expire, key="pair.expire")

    def expire(self) -> None:
        if self.request:
            self.loop.emit("pair.result", {"ok": False, "reason": "no bump", "kind": self.request["kind"]}, to="all")
        self.request, self.bumps, self.state.pairing = None, [], None

    def on_gesture(self, g) -> None:
        if g.kind != "bump" or not self.request or not g.device_id:
            return
        now_ms = float(g.t_server)
        self.bumps = [(t, d) for t, d in self.bumps if now_ms - t <= self.window_ms * 4] + [(now_ms, g.device_id)]
        recent = {d: t for t, d in self.bumps if now_ms - t <= self.window_ms}
        if len(recent) >= 3:
            self.bumps = []
            self.loop.cancel("pair.settle")
            self.loop.emit("pair.prompt", {"kind": self.request["kind"], "text": "Too many phones. Just two: bump again", "until_ts": int(self.request["until"] * 1000)}, to="all")
            return
        if len(recent) == 2 and self.request["requester"] in recent:
            other = next(d for d in recent if d != self.request["requester"])
            # settle after the bump window so a third phone can still turn this into a re-bump
            self.loop.schedule_in(self.window_ms / 1000.0, lambda: self.complete(other), key="pair.settle")

    def complete(self, other: str) -> None:
        if not self.request:
            return
        r, self.request = self.request, None
        self.loop.cancel("pair.expire")
        self.bumps, self.state.pairing = [], None
        assert r
        kind, me = r["kind"], r["requester"]
        result: dict[str, Any] = {"ok": True, "kind": kind, "a": self._nick(me), "b": self._nick(other)}
        now = self.loop.clock.now()
        if kind == "transfer" and self.market:
            amt = int(r.get("amount") or 0)
            if 0 < amt <= self.market.ledger.balance(me):
                self.market.ledger.append(me, -amt, "transfer_out", other, now)
                self.market.ledger.append(other, amt, "transfer_in", me, now)
                for d in (me, other):
                    self.state.balances[d] = self.market.ledger.balance(d)
                    self.loop.emit("market.balance", {"balance": self.state.balances[d], "reason": "transfer"}, to=("device", d))
                result["amount"] = amt
                self.market.emit_leaderboard()
            else:
                result.update(ok=False, reason="not enough chips")
        elif kind == "pass_seat":
            seat = self.rooms.seat_of_device(me)
            if seat:
                self._rebind(seat, other)
                result["seat_id"] = seat.seat_id
            else:
                result.update(ok=False, reason="requester holds no seat")
        elif kind == "bind_glove":
            free = next((s for s in self.state.seats.values() if s.status == "open" and s.hand), None)
            if free:
                self._rebind(free, other)
                result["seat_id"] = free.seat_id
            else:
                result.update(ok=False, reason="no free glove seat")
        elif kind == "tag":
            active = next((s for s in self.state.seats.values() if s.side == "active"), None)
            bench = next((s for s in self.state.seats.values() if s.side == "bench"), None)
            if active and bench and active.device_id and bench.device_id:
                a_dev, b_dev = active.device_id, bench.device_id
                self._rebind(active, b_dev); self._rebind(bench, a_dev)
                result["swapped"] = True
            else:
                result.update(ok=False, reason="tag team seats not both claimed")
        self.loop.emit("pair.result", result, to="all")

    def _rebind(self, seat, device_id: str) -> None:
        old = seat.device_id
        if old and old in self.state.devices and old != device_id:
            self.state.devices[old].seat_id = None
        dev = self.state.devices.get(device_id)
        seat.status, seat.device_id, seat.nickname = "claimed", device_id, dev.nickname if dev else None
        seat.claimed_ts = self.loop.clock.now()
        if dev:
            dev.seat_id = seat.seat_id
            dev.role = "remote"
        self.rooms.emit_seats()
        self.loop.emit("session.welcome", self.rooms._welcome(dev, seat, None), to=("device", device_id)) if dev else None

    def _nick(self, device_id: str) -> str:
        d = self.state.devices.get(device_id)
        return d.nickname if d and d.nickname else device_id[:6]


def install(arena) -> PairingModule:
    return PairingModule(arena)
