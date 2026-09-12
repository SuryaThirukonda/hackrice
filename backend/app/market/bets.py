"""Markets with parimutuel settlement. Pure integer chip math with a conservation invariant.

settle(): pool = stakes + rollover_in; winners split pro rata (floor); remainder -> rollover_out.
No winning backers -> whole pool rolls over. Ties split the pool evenly across winning outcomes first.
void(): every stake refunded at face value; rollover_in passes through untouched.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Any

from .ledger import Ledger

_ids = itertools.count(1)


@dataclass
class Bet:
    bet_id: str
    market_id: str
    device_id: str
    outcome_id: str
    stake: int
    ts: float


@dataclass
class Outcome:
    id: str
    label: str
    pool: int = 0


@dataclass
class Market:
    market_id: str
    match_id: str | None
    kind: str                      # match_winner | turn_outcome | round_winner | test
    label: str
    outcomes: list[Outcome]
    closes_ts: float
    turn_no: int | None = None
    status: str = "open"           # open | closed | settled | void
    bets: list[Bet] = field(default_factory=list)
    rollover_in: int = 0
    rollover_out: int = 0
    winner: list[str] | None = None
    payouts: dict[str, int] = field(default_factory=dict)
    seed_stake: dict[str, int] = field(default_factory=dict)   # visible House stake (The Closer); not a bettor

    def outcome(self, oid: str) -> Outcome | None:
        return next((o for o in self.outcomes if o.id == oid), None)

    @property
    def open(self) -> bool:
        return self.status == "open"

    def pools(self) -> dict[str, int]:
        return {o.id: o.pool for o in self.outcomes}

    def total_stakes(self) -> int:
        return sum(b.stake for b in self.bets)

    def public(self) -> dict[str, Any]:
        return {"market_id": self.market_id, "match_id": self.match_id, "kind": self.kind, "label": self.label, "turn_no": self.turn_no,
                "outcomes": [{"id": o.id, "label": o.label, "pool": o.pool} for o in self.outcomes], "closes_ts": int(self.closes_ts * 1000),
                "open": self.open, "status": self.status, "winner": self.winner, "rollover_in": self.rollover_in,
                "pool": self.total_stakes() + self.rollover_in, "n_bets": len(self.bets)}


class BetError(ValueError):
    pass


class MarketBook:
    """All markets for the session. Rollover chains per match."""

    def __init__(self, ledger: Ledger, min_bet: int = 10, max_stake: int = 200):
        self.ledger = ledger
        self.min_bet, self.max_stake = min_bet, max_stake
        self.markets: dict[str, Market] = {}
        self.pending_rollover: dict[str | None, int] = {}   # match_id -> chips waiting for the next market

    def open_market(self, match_id: str | None, kind: str, label: str, outcomes: list[tuple[str, str]], closes_ts: float, turn_no: int | None = None,
                    seed_stake: dict[str, int] | None = None) -> Market:
        mid = f"mk_{next(_ids)}"
        m = Market(mid, match_id, kind, label, [Outcome(i, l) for i, l in outcomes], closes_ts, turn_no)
        m.rollover_in = self.pending_rollover.pop(match_id, 0)
        if seed_stake:
            m.seed_stake = dict(seed_stake)
            for oid, amt in seed_stake.items():
                o = m.outcome(oid)
                if o:
                    o.pool += amt
        self.markets[mid] = m
        return m

    def place(self, market_id: str, device_id: str, outcome_id: str, stake: int, ts: float) -> Bet:
        m = self.markets.get(market_id)
        if m is None:
            raise BetError("no such market")
        if not m.open or ts > m.closes_ts:
            raise BetError("window closed")
        o = m.outcome(outcome_id)
        if o is None:
            raise BetError("no such outcome")
        if stake < self.min_bet:
            raise BetError(f"minimum stake is {self.min_bet}")
        if stake > self.max_stake:
            raise BetError(f"maximum stake is {self.max_stake}")
        if self.ledger.balance(device_id) < stake:
            raise BetError("not enough chips")
        b = Bet(f"b_{next(_ids)}", market_id, device_id, outcome_id, stake, ts)
        self.ledger.append(device_id, -stake, "bet_place", market_id, ts)
        m.bets.append(b)
        o.pool += stake
        if self.ledger.store is not None:
            self.ledger.store.write("bets", {"bet_id": b.bet_id, "market_id": market_id, "device_id": device_id, "outcome_id": outcome_id, "stake": stake, "ts": ts})
        return b

    def close(self, market_id: str) -> None:
        m = self.markets[market_id]
        if m.status == "open":
            m.status = "closed"

    def settle(self, market_id: str, winners: list[str] | str, ts: float) -> Market:
        m = self.markets[market_id]
        assert m.status in ("open", "closed"), m.status
        winners = [winners] if isinstance(winners, str) else list(winners)
        m.status, m.winner = "settled", winners
        pool = m.total_stakes() + m.rollover_in
        payouts: dict[str, int] = {}
        paid = 0
        # winning outcomes with backers share the pool evenly; within an outcome, pro rata
        backed = [w for w in winners if any(b.outcome_id == w for b in m.bets)]
        if backed:
            share = pool // len(backed)
            for w in backed:
                wbets = [b for b in m.bets if b.outcome_id == w]
                wpool = sum(b.stake for b in wbets)
                for b in wbets:
                    amt = (b.stake * share) // wpool
                    payouts[b.device_id] = payouts.get(b.device_id, 0) + amt
                    paid += amt
        m.rollover_out = pool - paid
        for dev, amt in payouts.items():
            if amt > 0:
                self.ledger.append(dev, amt, "bet_payout", market_id, ts)
        m.payouts = payouts
        if m.rollover_out:
            self.pending_rollover[m.match_id] = self.pending_rollover.get(m.match_id, 0) + m.rollover_out
        self.assert_conserved(m)
        self._persist(m, ts)
        return m

    def void(self, market_id: str, ts: float) -> Market:
        m = self.markets[market_id]
        if m.status in ("settled", "void"):
            return m
        m.status = "void"
        for b in m.bets:
            self.ledger.append(b.device_id, b.stake, "bet_refund", market_id, ts)
            m.payouts[b.device_id] = m.payouts.get(b.device_id, 0) + b.stake
        m.rollover_out = m.rollover_in
        if m.rollover_out:
            self.pending_rollover[m.match_id] = self.pending_rollover.get(m.match_id, 0) + m.rollover_out
        self._persist(m, ts)
        return m

    def flush_rollover(self, match_id: str | None, ts: float) -> int:
        """At match end, chips nobody won are refunded pro rata to... nobody: they go back to the House (removed).
        Keeping them in a pending pool forever would violate 'balances derive from ledger'; so we report them as burned."""
        return self.pending_rollover.pop(match_id, 0)

    def assert_conserved(self, m: Market) -> None:
        stakes = m.total_stakes()
        paid = sum(m.payouts.values())
        assert stakes + m.rollover_in == paid + m.rollover_out, f"market {m.market_id} leaks chips: {stakes}+{m.rollover_in} != {paid}+{m.rollover_out}"

    def _persist(self, m: Market, ts: float) -> None:
        if self.ledger.store is not None:
            self.ledger.store.write("markets", {"market_id": m.market_id, "match_id": m.match_id, "turn_no": m.turn_no, "kind": m.kind,
                                                "winner": ",".join(m.winner or []), "pool": m.total_stakes() + m.rollover_in,
                                                "rollover_in": m.rollover_in, "rollover_out": m.rollover_out, "settled_ts": ts})

    def open_markets(self, match_id: str | None = None) -> list[Market]:
        return [m for m in self.markets.values() if m.open and (match_id is None or m.match_id == match_id)]

    def implied(self, market_id: str, outcome_id: str) -> float:
        m = self.markets[market_id]
        total = sum(o.pool for o in m.outcomes)
        o = m.outcome(outcome_id)
        return (o.pool / total) if (o and total) else 1.0 / max(1, len(m.outcomes))
