"""Rail bots: N spectators that bet on every open market. Asserts chip conservation from the client side at exit.

  uv run python scripts/fake_rail.py --n 12 --every 5 --seconds 120
  uv run python scripts/fake_rail.py --n 5 --sponsor --vote      # --sponsor buys a move after match.start and bids on every crate
"""
from __future__ import annotations

import argparse
import asyncio
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts._client import Client  # noqa: E402

NICKS = ["Ace", "Lucky", "Whale", "Rookie", "Dice", "Nova", "Hawk", "Slugger", "Cash", "Sly", "Bolt", "Pip"]


class Bot:
    def __init__(self, i: int, a):
        self.a = a
        self.rng = random.Random(a.seed + i if a.seed is not None else None)
        self.c = Client("rail", a.url, device_id=f"railbot-{i}-{random.randrange(10**6)}", nickname=NICKS[i % len(NICKS)] + (str(i // len(NICKS)) if i >= len(NICKS) else ""))
        self.balance = 0
        self.bets = 0
        self.rejections = 0
        self.grants = 0
        self.wins = 0
        self.bet_on: set[str] = set()

    async def run(self):
        c = self.c
        await c.connect()
        self.balance = (c.welcome or {}).get("balance", 0)

        def on_balance(m):
            self.balance = m["d"]["balance"]
            if m["d"].get("reason") in ("join_grant", "bailout", "host_adjust"):
                self.grants += m["d"].get("amount", 500 if m["d"]["reason"] == "join_grant" else 0)
            if m["d"].get("reason") == "bet_payout":
                self.wins += 1
        c.on("market.balance", on_balance)
        c.on("market.bet_ack", lambda m: setattr(self, "balance", m["d"]["balance"]) or (self.bets_inc() if m["d"]["ok"] else self.rej_inc()))
        async def on_window(m):
            d = m["d"]
            if not d.get("open") or d["market_id"] in self.bet_on:
                return
            self.bet_on.add(d["market_id"])
            await asyncio.sleep(self.rng.uniform(0.05, min(self.a.every, 2.0)))
            stake = self.rng.choice([10, 25, 25, 50, 100])
            if self.balance >= stake:
                await c.send("market.bet", {"market_id": d["market_id"], "outcome_id": self.rng.choice(d["outcomes"])["id"], "stake": stake})
        c.on("market.window", on_window)
        if self.a.vote:
            voted = {"ts": None}                                             # one vote per window: the server re-broadcasts the tally as card.vote_open
            async def on_vote_open(m):
                if voted["ts"] == m["d"].get("closes_ts"):
                    return
                voted["ts"] = m["d"].get("closes_ts")
                await asyncio.sleep(self.rng.uniform(0.05, 0.3))
                await c.send("card.vote", {"pairing_id": self.rng.choice(m["d"]["pairings"])["id"]})
            c.on("card.vote_open", on_vote_open)
        if self.a.sponsor:
            async def on_start(m):
                await asyncio.sleep(self.rng.uniform(3, 8))
                moves = [x for x in (c.snapshot or {}).get("moves", []) if x.get("sport") in (None, m["d"]["sport"])]
                if moves:
                    await c.send("sponsor.buy", {"move_id": self.rng.choice(moves)["id"]})
            c.on("match.start", on_start)
            async def on_crate(m):
                await asyncio.sleep(self.rng.uniform(0.1, 0.5))
                amt = self.rng.choice([20, 40, 60, 90])
                if self.balance >= amt:
                    await c.send("crate.bid", {"amount": amt})
            c.on("crate.open", lambda m: asyncio.ensure_future(on_crate(m)))          # --sponsor also bids in crate auctions
        for s in ((c.snapshot or {}).get("markets") or []):
            if s.get("open"):
                await on_window({"d": s})
        await asyncio.sleep(self.a.seconds)
        await c.close()

    def bets_inc(self): self.bets += 1
    def rej_inc(self): self.rejections += 1


async def main(a):
    bots = [Bot(i, a) for i in range(a.n)]
    t0 = time.time()
    await asyncio.gather(*(b.run() for b in bots))
    total = sum(b.balance for b in bots)
    bets = sum(b.bets for b in bots)
    rej = sum(b.rejections for b in bots)
    print(f"[fake_rail] {a.n} bots, {bets} bets, {rej} rejections, {time.time() - t0:.0f}s, balances sum={total}")
    if a.n_check and bets:
        # Conservation from the client side: what the bots hold + what is still in open pools (unknown here) must not exceed what was granted.
        granted = sum(500 + (b.grants - (500 if b.grants >= 500 else 0)) for b in bots)
        print(f"[fake_rail] granted≈{granted}; bots hold {total} (difference is chips in unsettled pools, rollover, or won by non-bots)")
        assert total <= granted + 100 * a.n, "bots hold more than could have been granted"


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="ws://localhost:8000")
    ap.add_argument("--n", type=int, default=6)
    ap.add_argument("--every", type=float, default=5.0)
    ap.add_argument("--seconds", type=float, default=60)
    ap.add_argument("--sponsor", action="store_true")
    ap.add_argument("--vote", action="store_true")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--n-check", action="store_true", default=True)
    asyncio.run(main(ap.parse_args()))
