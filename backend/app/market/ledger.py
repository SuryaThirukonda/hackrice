"""Append-only chip ledger. Balances are derived (sum of deltas), never edited in place."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

REASONS = ("join_grant", "bet_place", "bet_payout", "bet_refund", "bailout", "sponsor_buy", "crate_bid", "crate_refund",
           "transfer_in", "transfer_out", "host_adjust")


@dataclass
class Entry:
    id: int
    device_id: str
    delta: int
    reason: str
    ref_id: str | None
    ts: float


class Ledger:
    def __init__(self, store=None, starting_stack: int = 500, bailout_amount: int = 100, bailout_below: int = 10, bailout_cooldown_s: float = 60):
        self.store = store
        self.entries: list[Entry] = []
        self.balances: dict[str, int] = {}
        self.granted: set[str] = set()
        self.last_bailout: dict[str, float] = {}
        self.starting_stack = starting_stack
        self.bailout_amount, self.bailout_below, self.bailout_cooldown_s = bailout_amount, bailout_below, bailout_cooldown_s
        self.total_granted = 0

    def append(self, device_id: str, delta: int, reason: str, ref_id: str | None, ts: float) -> Entry:
        assert reason in REASONS, reason
        assert isinstance(delta, int), "chips are integers"
        e = Entry(len(self.entries) + 1, device_id, delta, reason, ref_id, ts)
        self.entries.append(e)
        self.balances[device_id] = self.balances.get(device_id, 0) + delta
        if reason in ("join_grant", "bailout", "host_adjust"):
            self.total_granted += delta
        if self.store is not None:
            self.store.write("ledger", {"device_id": device_id, "delta": delta, "reason": reason, "ref_id": ref_id, "ts": ts})
        return e

    def balance(self, device_id: str) -> int:
        return self.balances.get(device_id, 0)

    def grant_on_join(self, device_id: str, ts: float) -> bool:
        if device_id in self.granted:
            return False
        self.granted.add(device_id)
        self.append(device_id, self.starting_stack, "join_grant", None, ts)
        return True

    def maybe_bailout(self, device_id: str, ts: float) -> int:
        """A broke bettor gets a refill after the cooldown. Returns the amount granted (0 if not due)."""
        if device_id not in self.granted or self.balance(device_id) >= self.bailout_below:
            return 0
        if ts - self.last_bailout.get(device_id, -1e9) < self.bailout_cooldown_s:
            return 0
        self.last_bailout[device_id] = ts
        self.append(device_id, self.bailout_amount, "bailout", None, ts)
        return self.bailout_amount

    def total(self) -> int:
        return sum(self.balances.values())

    def public(self, device_id: str) -> dict[str, Any]:
        return {"device_id": device_id, "balance": self.balance(device_id)}
