"""Agent-vs-agent card: the rail votes between two pairings, then the House fights itself. Fills dead air when idle."""
from __future__ import annotations

import random
from typing import Any

from ..arena import Intent


class CardModule:
    def __init__(self, arena):
        self.arena = arena
        self.loop, self.state, self.config = arena.loop, arena.state, arena.config
        self.games = arena.modules.get("games.wiring")
        mc = self.config.section("market").get("card", {})
        self.vote_s, self.idle_s = float(mc.get("vote_s", 15)), float(mc.get("idle_start_s", 20))
        self.vote: dict[str, Any] | None = None
        self.rng = random.Random()
        self.idle_since: float | None = None
        self.loop.on("card.vote", self.on_vote)
        self.loop.on("host.card", self.on_host_card)
        self.loop.schedule_every(2.0, self.idle_check, key="card.idle")

    def pairings(self) -> list[dict[str, Any]]:
        tiers = self.config.tiers("boxing")
        ids = [t["id"] for t in tiers]
        names = {t["id"]: t["name"] for t in tiers}
        pairs = []
        tried = set()
        while len(pairs) < 2 and len(tried) < 12:
            a, b = self.rng.sample(ids, 2)
            key = tuple(sorted((a, b)))
            tried.add(key)
            if key in {tuple(sorted((p["a"], p["b"]))) for p in pairs}:
                continue
            pairs.append({"id": f"{a}_vs_{b}", "a": a, "b": b, "label": f"{names[a]} vs {names[b]}"})
        return pairs

    def on_host_card(self, i: Intent) -> None:
        if i.d.get("vote", True) and not i.d.get("a"):
            self.open_vote()
        # direct start with explicit fighters is handled by the games module's own host.card handler

    def open_vote(self) -> None:
        if self.vote or (self.games and self.games.match and not self.games.match.ended):
            return
        pairs = self.pairings()
        self.vote = {"pairings": pairs, "votes": {}, "closes_ts": int((self.loop.clock.now() + self.vote_s) * 1000)}
        self.state.card = {"pairings": pairs, "closes_ts": self.vote["closes_ts"], "tally": {p["id"]: 0 for p in pairs}}
        self.loop.emit("card.vote_open", self.state.card, to="all")
        self.loop.schedule_in(self.vote_s, self.close_vote, key="card.close")

    def on_vote(self, i: Intent) -> None:
        if not self.vote or not i.device_id:
            return
        pid = i.d.get("pairing_id")
        if pid in {p["id"] for p in self.vote["pairings"]}:
            if self.vote["votes"].get(i.device_id) == pid:
                return                                                   # same vote again: nothing changed, no re-broadcast
            self.vote["votes"][i.device_id] = pid
            tally = {p["id"]: 0 for p in self.vote["pairings"]}
            for v in self.vote["votes"].values():
                tally[v] += 1
            self.state.card["tally"] = tally
            self.loop.emit("card.vote_open", self.state.card, to="all")

    def close_vote(self) -> None:
        v, self.vote = self.vote, None
        if not v:
            return
        tally = {p["id"]: 0 for p in v["pairings"]}
        for x in v["votes"].values():
            tally[x] += 1
        best = max(tally.values()) if tally else 0
        winners = [p for p in v["pairings"] if tally[p["id"]] == best]
        pick = self.rng.choice(winners)
        self.state.card = {"pairings": v["pairings"], "tally": tally, "winner": pick, "done": True}
        self.loop.emit("card.vote_result", self.state.card, to="all")
        if self.games:
            try:
                self.games.start_match("boxing", pick["a"], None, None, card=True, tiers=(pick["a"], pick["b"]))
            except Exception as e:  # noqa: BLE001
                self.loop.emit("host.ack", {"cmd": "card", "ok": False, "reason": str(e)}, to="host")

    def idle_check(self) -> None:
        if not self.state.toggles.get("card_when_idle", True) or self.vote:
            return
        live = self.games and self.games.match and not self.games.match.ended
        claimed = any(s.status == "claimed" for s in self.state.seats.values())
        now = self.loop.clock.now()
        if live or claimed or not any(c.role == "rail" for c in self.loop.conns.values()):
            self.idle_since = None
            return
        if self.idle_since is None:
            self.idle_since = now
        elif now - self.idle_since >= self.idle_s:
            self.idle_since = None
            self.open_vote()


def install(arena) -> CardModule:
    return CardModule(arena)
