"""Market module: wires ledger + markets to the arena (bets, odds throttle, settlement events, leaderboard, bailout)."""
from __future__ import annotations

from typing import Any

from ..arena import Intent
from .bets import BetError, MarketBook
from .ledger import Ledger

TITLES = {"hot_hand": "Hot hand", "called_it": "Called it", "whale": "Whale"}


class MarketModule:
    def __init__(self, arena):
        self.arena = arena
        self.loop, self.state, self.config = arena.loop, arena.state, arena.config
        mc = self.config.section("market")
        self.ledger = Ledger(arena.store, int(mc["starting_stack"]), int(mc["bailout"]["amount"]), int(mc["bailout"]["below"]), float(mc["bailout"]["cooldown_s"]))
        self.book = MarketBook(self.ledger, int(mc["min_bet"]), int(mc["max_stake"]))
        self.odds_interval = 1.0 / float(mc.get("odds_hz", 4))
        self._odds_dirty: set[str] = set()
        self.streaks: dict[str, int] = {}
        self.upsets: dict[str, int] = {}
        self.volume: dict[str, int] = {}
        self.loop.on("market.bet", self.on_bet)
        self.loop.on("host.adjust_chips", self.on_adjust)
        self.loop.on("host.force_scenario", self.on_force_scenario)
        self.loop.schedule_every(self.odds_interval, self.flush_odds, key="market.odds")
        self.loop.schedule_every(5.0, self.bailout_sweep, key="market.bailout")
        arena.rooms.on_join.append(self.on_join)

    # ---- joins & balances ---------------------------------------------------
    def on_join(self, dev) -> None:
        if dev.role not in ("rail", "remote"):
            return
        now = self.loop.clock.now()
        if self.ledger.grant_on_join(dev.device_id, now):
            self.state.balances[dev.device_id] = self.ledger.balance(dev.device_id)
            self.loop.emit("market.balance", {"balance": self.ledger.balance(dev.device_id), "reason": "join_grant"}, to=("device", dev.device_id))
            self.emit_leaderboard()

    def bailout_sweep(self) -> None:
        now = self.loop.clock.now()
        for dev in self.state.devices.values():
            if dev.role != "rail" and not dev.connected:
                continue
            amt = self.ledger.maybe_bailout(dev.device_id, now)
            if amt:
                self.state.balances[dev.device_id] = self.ledger.balance(dev.device_id)
                self.loop.emit("market.balance", {"balance": self.ledger.balance(dev.device_id), "reason": "bailout", "amount": amt}, to=("device", dev.device_id))

    def on_adjust(self, i: Intent) -> None:
        dev, delta = i.d.get("device_id"), int(i.d.get("delta", 0))
        if dev and delta:
            self.ledger.append(dev, delta, "host_adjust", None, self.loop.clock.now())
            self.state.balances[dev] = self.ledger.balance(dev)
            self.loop.emit("market.balance", {"balance": self.ledger.balance(dev), "reason": "host_adjust"}, to=("device", dev))
            self.emit_leaderboard()

    # ---- markets ---------------------------------------------------------------
    def open_market(self, match_id: str | None, kind: str, label: str, outcomes: list[tuple[str, str]], window_s: float, turn_no: int | None = None,
                    seed_stake: dict[str, int] | None = None):
        now = self.loop.clock.now()
        m = self.book.open_market(match_id, kind, label, outcomes, now + window_s, turn_no, seed_stake)
        self.state.markets[m.market_id] = m.public()
        self.loop.emit("market.window", m.public(), to="all")
        self.loop.schedule_at(m.closes_ts, lambda: self.close_market(m.market_id), key=f"market.close:{m.market_id}")
        return m

    def close_market(self, market_id: str) -> None:
        m = self.book.markets.get(market_id)
        if not m or not m.open:
            return
        self.book.close(market_id)
        self.state.markets[market_id] = m.public()
        self.loop.emit("market.window", m.public(), to="all")

    def settle(self, market_id: str, winners, detail: dict[str, Any] | None = None) -> None:
        m = self.book.markets.get(market_id)
        if not m or m.status in ("settled", "void"):
            return
        self.loop.cancel(f"market.close:{market_id}")
        favorite = max(m.outcomes, key=lambda o: o.pool).id if any(o.pool for o in m.outcomes) else None
        m = self.book.settle(market_id, winners, self.loop.clock.now())
        upset = favorite is not None and favorite not in (m.winner or []) and any(b.outcome_id in (m.winner or []) for b in m.bets)
        for b in m.bets:
            won = b.outcome_id in (m.winner or [])
            self.streaks[b.device_id] = (self.streaks.get(b.device_id, 0) + 1) if won else 0
            if won and upset:
                self.upsets[b.device_id] = self.upsets.get(b.device_id, 0) + 1
            self.volume[b.device_id] = self.volume.get(b.device_id, 0) + b.stake
        for dev, amt in m.payouts.items():
            self.state.balances[dev] = self.ledger.balance(dev)
            self.loop.emit("market.balance", {"balance": self.ledger.balance(dev), "reason": "bet_payout", "amount": amt, "market_id": market_id}, to=("device", dev))
        for b in m.bets:
            if b.device_id not in m.payouts:
                self.loop.emit("market.balance", {"balance": self.ledger.balance(b.device_id), "reason": "bet_lost", "amount": -b.stake, "market_id": market_id}, to=("device", b.device_id))
        self.state.markets[market_id] = m.public()
        big = max(m.payouts.values(), default=0)
        self.loop.emit("market.settle", {"market_id": market_id, "kind": m.kind, "winner": m.winner, "payouts": [{"device_id": d, "nickname": self._nick(d), "amount": a} for d, a in m.payouts.items()],
                                         "rollover": m.rollover_out, "pool": m.total_stakes() + m.rollover_in, "upset": upset, "biggest": big, "detail": detail or {}}, to="all")
        self.emit_leaderboard()

    def void(self, market_id: str) -> None:
        m = self.book.markets.get(market_id)
        if not m or m.status in ("settled", "void"):
            return
        self.loop.cancel(f"market.close:{market_id}")
        m = self.book.void(market_id, self.loop.clock.now())
        for dev in m.payouts:
            self.state.balances[dev] = self.ledger.balance(dev)
            self.loop.emit("market.balance", {"balance": self.ledger.balance(dev), "reason": "bet_refund", "market_id": market_id}, to=("device", dev))
        self.state.markets[market_id] = m.public()
        self.loop.emit("market.settle", {"market_id": market_id, "kind": m.kind, "winner": None, "void": True, "payouts": [], "rollover": m.rollover_out, "pool": 0}, to="all")

    def end_match(self, match_id: str | None) -> None:
        for m in list(self.book.markets.values()):
            if m.match_id == match_id and m.status in ("open", "closed"):
                self.void(m.market_id)
        burned = self.book.flush_rollover(match_id, self.loop.clock.now())
        for mid in [k for k, v in self.state.markets.items() if v.get("match_id") == match_id]:
            self.state.markets.pop(mid, None)
        if burned:
            self.loop.emit("sfx.play", {"name": "house_takes", "gain": 0.6, "amount": burned}, to="projector")

    def on_bet(self, i: Intent) -> None:
        dev = i.device_id
        if not dev:
            return
        try:
            b = self.book.place(i.d["market_id"], dev, i.d["outcome_id"], int(i.d["stake"]), self.loop.clock.now())
        except BetError as e:
            self.loop.emit("market.bet_ack", {"ok": False, "reason": str(e), "market_id": i.d.get("market_id"), "balance": self.ledger.balance(dev), "cseq": i.cseq}, to=("conn", i.conn_id) if i.conn_id else ("device", dev))
            return
        self.state.balances[dev] = self.ledger.balance(dev)
        self.loop.emit("market.bet_ack", {"ok": True, "bet_id": b.bet_id, "market_id": b.market_id, "outcome_id": b.outcome_id, "stake": b.stake, "balance": self.ledger.balance(dev), "cseq": i.cseq}, to=("conn", i.conn_id) if i.conn_id else ("device", dev))
        self._odds_dirty.add(b.market_id)

    def flush_odds(self) -> None:
        for mid in list(self._odds_dirty):
            m = self.book.markets.get(mid)
            if m:
                self.state.markets[mid] = m.public()
                self.loop.emit("market.odds", {"market_id": mid, "pools": m.pools(), "pool": m.total_stakes() + m.rollover_in, "n_bets": len(m.bets)}, to="all")
        self._odds_dirty.clear()

    def on_force_scenario(self, i: Intent) -> None:
        if i.d.get("kind") == "test_market":
            self.open_market(None, "test", "Test market: heads or tails", [("heads", "Heads"), ("tails", "Tails")], float(i.d.get("window_s", 5)))
            self.loop.schedule_in(float(i.d.get("window_s", 5)) + 0.5, lambda: self.settle(list(self.book.markets)[-1], "heads"), key="test_market.settle")
            self.loop.emit("host.ack", {"cmd": "force_scenario", "ok": True, "kind": "test_market"}, to="host")

    # ---- leaderboard ------------------------------------------------------------
    def _nick(self, device_id: str) -> str:
        d = self.state.devices.get(device_id)
        return (d.nickname if d and d.nickname else device_id[:6])

    def rows(self) -> list[dict[str, Any]]:
        rows = []
        for dev_id, chips in self.ledger.balances.items():
            d = self.state.devices.get(dev_id)
            if d is None or d.role not in ("rail", "remote"):
                continue
            titles = []
            if self.streaks.get(dev_id, 0) >= 3:
                titles.append(TITLES["hot_hand"])
            if self.upsets.get(dev_id, 0) >= 1:
                titles.append(TITLES["called_it"])
            if self.volume.get(dev_id, 0) >= 500:
                titles.append(TITLES["whale"])
            rows.append({"device_id": dev_id, "nickname": self._nick(dev_id), "chips": chips, "titles": titles, "streak": self.streaks.get(dev_id, 0)})
        rows.sort(key=lambda r: -r["chips"])
        return rows[:20]

    def emit_leaderboard(self) -> None:
        self.state.leaderboard = self.rows()
        self.loop.emit("market.leaderboard", {"rows": self.state.leaderboard}, to="all")


def install(arena) -> MarketModule:
    return MarketModule(arena)
