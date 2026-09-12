"""Sponsor moves and the crate auction: bettors spend chips to nudge a live match, within caps and with a visible warning."""
from __future__ import annotations

import random
from typing import Any

from ..arena import Intent


class SponsorModule:
    def __init__(self, arena):
        self.arena = arena
        self.loop, self.state, self.config = arena.loop, arena.state, arena.config
        self.market = arena.modules.get("market.wiring")
        self.games = arena.modules.get("games.wiring")
        mc = self.config.section("market")
        self.sp = mc.get("sponsor", {})
        self.moves: dict[str, dict[str, Any]] = {m["id"]: m for m in mc.get("moves", [])}
        self.state.moves = [self.public_move(m) for m in self.moves.values()]
        self.applied: dict[str, dict[str, int]] = {}      # match_id -> move_id -> count
        self.cooldown_until: dict[str, float] = {}
        self.swing_used: dict[str, float] = {}           # match_id -> cumulative fraction of parameter range moved
        self.crate: dict[str, Any] | None = None
        self.turns_since_crate = 0
        self.rng = random.Random()
        self.loop.on("sponsor.buy", self.on_buy)
        self.loop.on("crate.bid", self.on_bid)
        if self.games:
            self.games.on_turn_result.append(self.on_turn_result)
            self.games.on_match_end.append(lambda m, w: self.close_crate(cancel=True))

    def public_move(self, m: dict[str, Any]) -> dict[str, Any]:
        return {"id": m["id"], "label": m["label"], "target": m["target"], "sport": m.get("sport"), "base_price": m["base_price"], "cap_per_match": m["cap_per_match"], "cooldown_s": m["cooldown_s"]}

    # ---- pricing ----------------------------------------------------------------------------------
    def price(self, move: dict[str, Any]) -> int:
        base = int(move["base_price"])
        adv = 0.0
        if self.market and self.games and self.games.match_market_id:
            target_outcome = "house" if move["target"] == "house" else "human"
            try:
                adv = self.market.book.implied(self.games.match_market_id, target_outcome) - 0.5
            except KeyError:
                adv = 0.0
        mult = 1 + float(self.sp.get("advantage_k", 0.8)) * adv * 2
        mult = max(float(self.sp.get("price_min_mult", 0.5)), min(float(self.sp.get("price_max_mult", 2.0)), mult))
        return max(1, int(round(base * mult)))

    def _err(self, i: Intent, reason: str, move_id: str | None = None) -> None:
        self.loop.emit("sponsor.ack", {"ok": False, "reason": reason, "move_id": move_id, "cseq": i.cseq}, to=("conn", i.conn_id) if i.conn_id else ("device", i.device_id))

    # ---- buying -----------------------------------------------------------------------------------
    def on_buy(self, i: Intent) -> None:
        move = self.moves.get(i.d.get("move_id", ""))
        m = self.games.match if self.games else None
        if not move:
            return self._err(i, "no such move")
        if not m or m.ended:
            return self._err(i, "no live match", move["id"])
        if not self.state.toggles.get("sponsor_moves", True):
            return self._err(i, "sponsor moves are disabled", move["id"])
        if move.get("sport") and move["sport"] != m.sport:
            return self._err(i, f"that move is for {move['sport']}", move["id"])
        if getattr(m, "card", None):
            return self._err(i, "no moves during the card", move["id"])
        now = self.loop.clock.now()
        if now < self.cooldown_until.get(move["id"], 0):
            return self._err(i, f"cooldown {int(self.cooldown_until[move['id']] - now)}s", move["id"])
        used = self.applied.setdefault(m.match_id, {})
        if used.get(move["id"], 0) >= int(move["cap_per_match"]):
            return self._err(i, "cap reached for this match", move["id"])
        p = self.price(move)
        if not self.market or self.market.ledger.balance(i.device_id) < p:
            return self._err(i, f"need {p} chips", move["id"])
        if not self._within_swing(m, move):
            return self._err(i, "the room has already swung this match as far as allowed", move["id"])
        self.market.ledger.append(i.device_id, -p, "sponsor_buy", move["id"], now)
        self.state.balances[i.device_id] = self.market.ledger.balance(i.device_id)
        self.loop.emit("market.balance", {"balance": self.state.balances[i.device_id], "reason": "sponsor_buy", "amount": -p}, to=("device", i.device_id))
        used[move["id"]] = used.get(move["id"], 0) + 1
        self.cooldown_until[move["id"]] = now + float(move["cooldown_s"])
        self.loop.emit("sponsor.ack", {"ok": True, "move_id": move["id"], "price": p, "cseq": i.cseq}, to=("conn", i.conn_id) if i.conn_id else ("device", i.device_id))
        self.schedule_apply(m, move, i.device_id, p)

    def schedule_apply(self, m, move: dict[str, Any], buyer: str | None, price: int) -> None:
        warn = float(self.sp.get("warn_s", 2))
        applies_at = self.loop.clock.now() + warn
        nick = self._nick(buyer)
        self.loop.emit("sponsor.warn", {"move_id": move["id"], "label": move["label"], "target": move["target"], "buyer": nick, "applies_at_ts": int(applies_at * 1000), "price": price}, to="all")
        self.loop.schedule_in(warn, lambda: self.apply(m, move, buyer, price), key=f"sponsor.apply:{move['id']}:{self.loop.clock.now_ms()}")

    def _within_swing(self, m, move: dict[str, Any]) -> bool:
        eff = move.get("effect", {})
        if "param" not in eff:
            return True
        spec = self.config.get(f"tiers.{m.sport}.adaptive") or {}
        rng_span = float(spec.get("max", 1)) - float(spec.get("min", 0)) if spec.get("param") == eff["param"] else 1.0
        frac = abs(float(eff["delta"])) / max(1e-9, rng_span)
        return self.swing_used.get(m.match_id, 0.0) + frac <= float(self.sp.get("max_swing", 0.35)) + 1e-9

    def apply(self, m, move: dict[str, Any], buyer: str | None, price: int) -> None:
        if not self.games or self.games.match is not m or m.ended:
            return
        eff = move.get("effect", {})
        if "param" in eff:
            m.adjustments[eff["param"]] = m.adjustments.get(eff["param"], 0.0) + float(eff["delta"])
            spec = self.config.get(f"tiers.{m.sport}.adaptive") or {}
            span = float(spec.get("max", 1)) - float(spec.get("min", 0)) if spec.get("param") == eff["param"] else 1.0
            self.swing_used[m.match_id] = self.swing_used.get(m.match_id, 0.0) + abs(float(eff["delta"])) / max(1e-9, span)
            if m.sport == "boxing" and getattr(m, "b", None) is not None and m.b.house:
                m.b.house.adjust[eff["param"]] = m.b.house.adjust.get(eff["param"], 0.0) + float(eff["delta"])
            if m.sport == "bowling" and eff["param"] == "lane_drift":
                m.lane_drift += float(eff["delta"])
        elif eff.get("grant") == "extra_frame" and hasattr(m, "grant_extra_frame"):
            m.grant_extra_frame()
        elif eff.get("grant") == "second_wind" and hasattr(m, "grant_second_wind"):
            m.grant_second_wind()
        m.sponsored_turn = True
        if hasattr(m, "send_effect"):
            m.send_effect(eff)
        self.loop.emit("sponsor.applied", {"move_id": move["id"], "label": move["label"], "target": move["target"], "buyer": self._nick(buyer), "effect": eff}, to="all")
        if self.arena.store is not None:
            self.arena.store.write("sponsor_moves", {"match_id": m.match_id, "turn_no": m.turn_no, "device_id": buyer, "move_id": move["id"], "target": move["target"], "price": price, "applied_ts": self.loop.clock.now()})

    # ---- crate auction -----------------------------------------------------------------------------------
    def on_turn_result(self, m, res) -> None:
        if getattr(m, "card", None) or not self.state.toggles.get("sponsor_moves", True):
            return
        self.turns_since_crate += 1
        if self.turns_since_crate >= int(self.sp.get("crate_every_turns", 4)) and self.crate is None:
            self.turns_since_crate = 0
            self.open_crate(m)

    def open_crate(self, m) -> None:
        cands = [mv for mv in self.moves.values() if not mv.get("sport") or mv["sport"] == m.sport]
        if not cands:
            return
        move = self.rng.choice(cands)
        secs = float(self.sp.get("crate_bid_s", 15))
        self.crate = {"move": self.public_move(move), "closes_ts": int((self.loop.clock.now() + secs) * 1000), "bids": {}, "match_id": m.match_id}
        self.state.crate = {"move": self.crate["move"], "closes_ts": self.crate["closes_ts"], "n_bids": 0}
        self.loop.emit("crate.open", self.state.crate, to="all")
        self.loop.schedule_in(secs, self.close_crate, key="crate.close")

    def on_bid(self, i: Intent) -> None:
        if not self.crate or not i.device_id:
            return
        amt = int(i.d.get("amount", 0))
        if self.market and self.market.ledger.balance(i.device_id) >= amt > 0:
            self.crate["bids"][i.device_id] = amt              # sealed: only the count is public
            self.state.crate["n_bids"] = len(self.crate["bids"])
            self.loop.emit("sponsor.ack", {"ok": True, "crate": True, "amount": amt, "cseq": i.cseq}, to=("conn", i.conn_id) if i.conn_id else ("device", i.device_id))

    def close_crate(self, cancel: bool = False) -> None:
        c, self.crate = self.crate, None
        self.state.crate = None
        self.loop.cancel("crate.close")
        if not c:
            return
        m = self.games.match if self.games else None
        if cancel or not m or m.ended or m.match_id != c["match_id"] or not c["bids"]:
            self.loop.emit("crate.result", {"winner": None, "move": c["move"], "reason": "cancelled" if cancel else "no bids"}, to="all")
            return
        winner, amt = max(c["bids"].items(), key=lambda kv: (kv[1], kv[0]))
        if self.market.ledger.balance(winner) < amt:
            self.loop.emit("crate.result", {"winner": None, "move": c["move"], "reason": "winner could not pay"}, to="all")
            return
        now = self.loop.clock.now()
        self.market.ledger.append(winner, -amt, "crate_bid", c["move"]["id"], now)
        self.state.balances[winner] = self.market.ledger.balance(winner)
        self.loop.emit("market.balance", {"balance": self.state.balances[winner], "reason": "crate_bid", "amount": -amt}, to=("device", winner))
        self.loop.emit("crate.result", {"winner": self._nick(winner), "amount": amt, "move": c["move"], "n_bids": len(c["bids"])}, to="all")
        self.schedule_apply(m, self.moves[c["move"]["id"]], winner, amt)

    def _nick(self, device_id: str | None) -> str:
        d = self.state.devices.get(device_id or "")
        return d.nickname if d and d.nickname else "the rail"


def install(arena) -> SponsorModule:
    return SponsorModule(arena)
