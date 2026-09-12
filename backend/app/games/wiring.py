"""Games module: the turn driver. Owns the current Match, phases, timers, markets per turn, decisions, ticks, pause."""
from __future__ import annotations

import itertools
import logging
import random
from typing import Any, Callable

from ..agents.policy import DecisionRequest, Option, TierConfig
from ..arena import Intent
from . import scripted
from .base import Match, TurnPlan, TurnResult

log = logging.getLogger("hap.games")
_match_ids = itertools.count(1)

DecisionProvider = Callable[[DecisionRequest, Callable[[Option, str, str | None, float], None]], None]


def match_class(sport: str):
    if sport == "bowling":
        from .bowling import BowlingMatch
        return BowlingMatch
    if sport == "baseball":
        from .baseball import BaseballMatch
        return BaseballMatch
    if sport == "boxing":
        from .boxing import BoxingMatch
        return BoxingMatch
    raise KeyError(sport)


class GamesModule:
    def __init__(self, arena):
        self.arena = arena
        self.loop, self.state, self.config, self.rooms = arena.loop, arena.state, arena.config, arena.rooms
        self.market = arena.modules.get("market.wiring")
        self.motion = arena.modules.get("motion.worker")
        self.match: Match | None = None
        self.plan: TurnPlan | None = None
        self.phase = "idle"
        self.paused = False
        self.pause_reason: str | None = None
        self._remaining: float | None = None
        self._resume_cb: Callable[[], None] | None = None
        self._deadline = 0.0
        self.turn_markets: dict[str, str] = {}
        self.match_market_id: str | None = None
        self.decision_provider: DecisionProvider | None = None
        self.on_turn_result: list[Callable[[Match, TurnResult], None]] = []
        self.on_match_start: list[Callable[[Match], None]] = []
        self.on_match_end: list[Callable[[Match, str], None]] = []
        self.on_trigger: list[Callable[[str, dict[str, Any], Match], None]] = []
        self.on_decision: list[Callable[[Match, DecisionRequest, Option, str, str | None], None]] = []
        self.history: list[dict[str, Any]] = []
        self.loop.on("host.start", self.on_host_start)
        self.loop.on("host.pause", lambda i: self.pause("host"))
        self.loop.on("host.resume", lambda i: self.resume())
        self.loop.on("host.next", lambda i: self.skip())
        self.loop.on("host.force_scenario", self.on_force_scenario)
        self.loop.on("host.card", self.on_host_card)
        if self.motion:
            self.motion.gesture_handlers.append(self.on_gesture)
        self.loop.schedule_every(0.5, self.gap_check, key="match.gapcheck")

    # ---- starting ---------------------------------------------------------------------------
    def tier_for(self, sport: str, tier_id: str | None) -> TierConfig:
        tiers = self.config.tiers(sport)
        d = next((t for t in tiers if t["id"] == tier_id), None) or tiers[0]
        return TierConfig.from_dict(sport, d)

    def on_host_start(self, i: Intent) -> None:
        sport = i.d.get("sport", "bowling")
        try:
            self.start_match(sport, i.d.get("tier"), i.d.get("scenario"), i.d.get("seats"), seed=i.d.get("seed"))
            self.loop.emit("host.ack", {"cmd": "start", "ok": True, "match_id": self.match.match_id if self.match else None}, to="host")
        except Exception as e:  # noqa: BLE001
            log.exception("start failed")
            self.loop.emit("host.ack", {"cmd": "start", "ok": False, "reason": str(e)}, to=["host", "projector"])

    def on_force_scenario(self, i: Intent) -> None:
        kind = i.d.get("kind")
        if kind in ("demo",) or kind in scripted.SCENARIOS.get(i.d.get("sport", "bowling"), {}):
            try:
                self.start_match(i.d.get("sport", "bowling"), i.d.get("tier"), kind, None)
                self.loop.emit("host.ack", {"cmd": "force_scenario", "ok": True, "kind": kind}, to="host")
            except Exception as e:  # noqa: BLE001
                self.loop.emit("host.ack", {"cmd": "force_scenario", "ok": False, "reason": str(e)}, to="host")

    def on_host_card(self, i: Intent) -> None:
        tiers = [t["id"] for t in self.config.tiers("boxing")]
        a = i.d.get("a") or self.arena_rng().choice(tiers)
        b = i.d.get("b") or self.arena_rng().choice([t for t in tiers if t != a])
        try:
            self.start_match("boxing", a, i.d.get("scenario"), None, card=True, tiers=(a, b))
            self.loop.emit("host.ack", {"cmd": "card", "ok": True, "a": a, "b": b}, to="host")
        except Exception as e:  # noqa: BLE001
            log.exception("card failed")
            self.loop.emit("host.ack", {"cmd": "card", "ok": False, "reason": str(e)}, to=["host", "projector"])

    def arena_rng(self) -> random.Random:
        return random.Random()

    def human_seats(self) -> list[str]:
        return [s.seat_id for s in self.rooms.claimed_seats()]

    def start_match(self, sport: str, tier_id: str | None = None, scenario: str | None = None, seat_mode: str | None = None, seed: int | None = None,
                    card: bool = False, tiers: tuple[str, str] | None = None) -> Match:
        if self.match and not self.match.ended:
            self.end_match("replaced")
        if seat_mode and seat_mode != self._current_seat_mode():
            self.rooms.configure_seats(seat_mode)
        seats = [] if card else self.human_seats()
        if not card and not seats:
            raise ValueError("no player seated: scan a seat QR first")
        players = {s: (self.state.seats[s].nickname or f"Player {s}") for s in seats}
        sc = scripted.load(sport, scenario)
        if self.config.mode == "scripted" and not sc:
            sc = scripted.load(sport, "demo")
        seed = seed if seed is not None else int(sc.get("seed", random.randrange(1, 2**31)))
        tier = self.tier_for(sport, tier_id)
        match_id = f"m_{next(_match_ids)}"
        cls = match_class(sport)
        kwargs: dict[str, Any] = {}
        if card:
            kwargs["card"] = tiers or ("champion", "boss")
        self.match = cls(match_id, seed, tier, seats, players, self.config, sc, **kwargs)
        self.match.phase = "starting"
        self.loop.match_id = match_id
        self.turn_markets = {}
        self.state.match = self.match.public()
        self.state.studying = {}
        if self.motion:
            self.motion.set_sport(sport)
        if self.arena.store is not None:
            self.arena.store.write("matches", {"match_id": match_id, "sport": sport, "seed": seed, "opponent_tier": tier.id, "scenario": scenario, "started_ts": self.loop.clock.now(), "ended_ts": None, "winner": None})
        self.loop.emit("match.start", self.match.public() | {"card": card}, to="all")
        self.fire_trigger("match_start", {"player": ", ".join(players.values()) or "The House", "opponent": tier.name})
        if self.market:
            spec = self.match.match_winner_market()
            m = self.market.open_market(match_id, spec.kind, spec.label, spec.outcomes, window_s=float(self.config.get("market.windows.betting_s", 12)) + 6, seed_stake=spec.seed_stake)
            self.match_market_id = m.market_id
        from ..agents.bosses import attach_boss
        attach_boss(self.match, self.arena)
        for cb in self.on_match_start:
            cb(self.match)
        self.begin_turn()
        return self.match

    def _current_seat_mode(self) -> str:
        ids = tuple(self.state.seats)
        return {("P1",): "single", ("L", "R"): "two_glove", ("A", "B"): "head_to_head", ("ACTIVE", "BENCH"): "tag_team", (): "none"}.get(ids, "custom")

    # ---- phases ---------------------------------------------------------------------------------
    def _set_phase(self, phase: str, deadline_s: float | None, extra: dict[str, Any] | None = None) -> None:
        assert self.match
        self.phase = phase
        self.match.phase = phase
        self._deadline = self.loop.clock.now() + (deadline_s or 0)
        d = {"turn_no": self.match.turn_no, "phase": phase, "deadline_ts": int(self._deadline * 1000) if deadline_s else None,
             "label": self.plan.label if self.plan else None, "seat_id": (self.plan.input_seats[0] if self.plan and self.plan.input_seats else None)}
        if extra:
            d.update(extra)
        self.state.match = self.match.public() | {"deadline_ts": d["deadline_ts"]}
        self.loop.emit("match.phase", d, to="all")

    def _after(self, delay_s: float, cb: Callable[[], None]) -> None:
        self._resume_cb = cb
        self.loop.schedule_in(delay_s, self._guard(cb), key="match.phase")

    def _guard(self, cb):
        m = self.match
        def run():
            if self.match is m and m is not None and not m.ended and not self.paused:
                cb()
        return run

    def begin_turn(self) -> None:
        m = self.match
        assert m
        plan = m.plan_turn()
        if plan is None:
            self.end_match("complete")
            return
        m.turn_no += 1
        self.plan = plan
        self.turn_markets = {}
        if plan.betting and self.market:
            for spec in plan.markets:
                mk = self.market.open_market(m.match_id, spec.kind, spec.label, spec.outcomes, window_s=float(self.config.get("market.windows.betting_s", 12)), turn_no=m.turn_no, seed_stake=spec.seed_stake)
                self.turn_markets[spec.kind] = mk.market_id
            self._set_phase("betting", float(self.config.get("market.windows.betting_s", 12)))
            self._after(float(self.config.get("market.windows.betting_s", 12)), self.enter_input)
        else:
            self.enter_input()

    def enter_input(self) -> None:
        m, plan = self.match, self.plan
        assert m and plan
        if self.match_market_id and self.market and m.turn_no == 1:
            self.market.close_market(self.match_market_id)
        for mid in self.turn_markets.values():
            self.market.close_market(mid) if self.market else None
        self._with_decisions("input", self._enter_input_now)

    def _enter_input_now(self) -> None:
        m, plan = self.match, self.plan
        assert m and plan
        tick_ms = float(getattr(plan, "tick_ms", 0) or 0)
        if not plan.input_seats and not tick_ms:
            self.enter_resolving()
            return
        self._set_phase("input", plan.input_window_s, {"prompt": plan.prompt})
        self._after(plan.input_window_s, self._input_timeout)
        if tick_ms:
            self.loop.schedule_every(tick_ms / 1000.0, self._live_tick, key="match.livetick")

    def _live_tick(self) -> None:
        m = self.match
        if not m or m.ended or self.phase != "input" or self.paused or not hasattr(m, "step"):
            return
        summary = m.step(now=self.loop.clock.now())
        self.loop.emit("match.tick", summary, to=["projector", "remote"])
        if m.input_done():
            self.loop.cancel("match.livetick")
            self.loop.cancel("match.phase")
            self.enter_resolving()

    def _input_timeout(self) -> None:
        m = self.match
        assert m
        self.loop.cancel("match.livetick")
        m.no_input()
        self.enter_resolving()

    def on_gesture(self, g) -> None:
        m, plan = self.match, self.plan
        if not m or m.ended or self.phase != "input" or self.paused or not plan or g.seat_id not in plan.input_seats:
            return
        if not m.on_gesture(g.seat_id, g):
            return
        if m.input_done():
            self.loop.cancel("match.phase")
            self.enter_resolving()
        else:
            prompt = m.next_prompt()
            if prompt is not None:
                remaining = max(3.0, self._deadline - self.loop.clock.now())
                self._set_phase("input", remaining, {"prompt": prompt})
                self._after(remaining, self._input_timeout)
                for t in getattr(m, "cur_ticks", [])[-1:]:
                    self.loop.emit("match.tick", t | {"live": True}, to="projector")

    def enter_resolving(self) -> None:
        self.loop.cancel("match.livetick")
        self._with_decisions("resolving", self._resolve_now)

    def _resolve_now(self) -> None:
        m = self.match
        assert m
        res = m.resolve()
        self._set_phase("resolving", res.animation_s)
        # emit ticks in order at their animation offsets; then settle; then between
        t = 0.0
        for k, tick in enumerate(res.ticks):
            self.loop.schedule_in(t, self._guard(lambda tick=tick: self.loop.emit("match.tick", tick, to="projector")), key=f"match.tick:{k}")
            t += float(tick.get("anim_s", 2.0))
        self.loop.emit("match.turn_result", {"turn_no": m.turn_no, "outcome": res.outcome, "detail": res.detail, "score": res.score, "label": self.plan.label if self.plan else None}, to="all")
        self.history.append({"turn_no": m.turn_no, "outcome": res.outcome, "detail": res.detail})
        if self.arena.store is not None:
            self.arena.store.write("turns", {"match_id": m.match_id, "turn_no": m.turn_no, "phase_ts_json": {"resolved": self.loop.clock.now()}, "outcome": res.outcome, "detail_json": res.detail})
        for cb in self.on_turn_result:
            cb(m, res)
        m.sponsored_turn = False
        def settle_and_continue():
            if self.market:
                for kind, winners in res.market_winners.items():
                    mid = self.turn_markets.get(kind)
                    if mid:
                        self.market.settle(mid, winners, {"turn_no": m.turn_no, "outcome": res.outcome})
            for name, data in res.triggers:
                self.fire_trigger(name, data)
            self.enter_between()
        self._after(res.animation_s, settle_and_continue)

    def enter_between(self) -> None:
        m = self.match
        assert m
        between = float(self.config.get("market.windows.between_s", 2))
        self._set_phase("between", between)
        self._after(between, self.begin_turn)

    def end_match(self, reason: str) -> None:
        m = self.match
        if not m or m.ended:
            return
        m.ended = True
        self.loop.cancel("match.phase")
        self.loop.cancel("match.livetick")
        for k in range(40):
            self.loop.cancel(f"match.tick:{k}")
        winner = m.winner() if reason == "complete" else "void"
        m.phase = "ended"
        if self.market:
            if self.match_market_id:
                mk = self.market.book.markets.get(self.match_market_id)
                ids = [o.id for o in mk.outcomes] if mk else []
                if winner in ids:
                    self.market.settle(self.match_market_id, winner)
                elif winner == "tie" and ids:
                    self.market.settle(self.match_market_id, ids)
                else:
                    self.market.void(self.match_market_id)
            self.market.end_match(m.match_id)
        if winner == "human":
            for nick in m.players.values():
                lad = self.state.ladder.setdefault(nick, {})
                tiers = [t["id"] for t in self.config.tiers(m.sport)]
                lad[m.sport] = max(lad.get(m.sport, 0), tiers.index(m.tier.id) + 1 if m.tier.id in tiers else 1)
            self.loop.emit("ladder.update", {"ladder": self.state.ladder}, to="all")
        self.state.match = m.public() | {"winner": winner, "reason": reason}
        self.phase = "ended"
        if self.arena.store is not None:
            self.arena.store.write("matches", {"match_id": m.match_id, "sport": m.sport, "seed": m.seed, "opponent_tier": m.tier.id, "scenario": None, "started_ts": None, "ended_ts": self.loop.clock.now(), "winner": winner})
        self.loop.emit("match.end", {"match_id": m.match_id, "winner": winner, "reason": reason, "score": m.summary(), "players": m.players, "opponent": m.tier.public(), "ladder": self.state.ladder}, to="all")
        if reason == "complete":
            self.fire_trigger("match_end", {"winner": (", ".join(m.players.values()) if winner == "human" else m.tier.name) if winner != "tie" else "Nobody"})
        for cb in self.on_match_end:
            cb(m, winner)
        if self.motion:
            self.motion.set_sport("idle")
        self.loop.match_id = None

    def skip(self) -> None:
        if self.match and not self.match.ended:
            self.end_match("skipped")

    # ---- pause -------------------------------------------------------------------------------------------
    def pause(self, reason: str) -> None:
        if not self.match or self.match.ended or self.paused:
            return
        self.paused, self.pause_reason = True, reason
        self._remaining = max(0.0, self._deadline - self.loop.clock.now()) if self.loop.has_timer("match.phase") else None
        self.loop.cancel("match.phase")
        self._live_paused = self.loop.has_timer("match.livetick")
        self.loop.cancel("match.livetick")
        self.state.match = self.match.public() | {"paused": True}
        self.loop.emit("match.pause", {"paused": True, "reason": reason}, to="all")

    def resume(self) -> None:
        if not self.match or not self.paused:
            return
        self.paused, self.pause_reason = False, None
        self.state.match = self.match.public() | {"paused": False}
        self.loop.emit("match.pause", {"paused": False}, to="all")
        if self._resume_cb and self._remaining is not None:
            self._deadline = self.loop.clock.now() + self._remaining
            self.loop.emit("match.phase", {"turn_no": self.match.turn_no, "phase": self.phase, "deadline_ts": int(self._deadline * 1000), "label": self.plan.label if self.plan else None, "seat_id": (self.plan.input_seats[0] if self.plan and self.plan.input_seats else None)}, to="all")
            self.loop.schedule_in(self._remaining, self._guard(self._resume_cb), key="match.phase")
        if getattr(self, "_live_paused", False) and self.plan and getattr(self.plan, "tick_ms", 0):
            self.loop.schedule_every(float(self.plan.tick_ms) / 1000.0, self._live_tick, key="match.livetick")  # type: ignore[attr-defined]

    def gap_check(self) -> None:
        """Pause at a safe point when the active player's phone stops sending frames; resume when frames return."""
        m, plan = self.match, self.plan
        if not m or m.ended or not plan:
            return
        gap_s = float(self.config.get("motion.frame_gap_pause_ms", 1500)) / 1000
        now = self.loop.clock.now()
        stalled = []
        for seat_id in plan.input_seats:
            seat = self.state.seats.get(seat_id)
            dev = self.state.devices.get(seat.device_id) if seat and seat.device_id else None
            streaming = dev is not None and dev.hz > 0
            if dev is None or (not dev.connected) or (streaming and dev.last_frame_ts and now - dev.last_frame_ts > gap_s):
                stalled.append(seat_id)   # keyboard remotes never stream frames; only a stalled phone stream pauses
        if stalled and not self.paused and self.phase in ("input", "betting"):
            self.pause("reconnect")
            self.loop.emit("motion.status", {"seat_id": stalled[0], "connected": False, "device_id": None}, to=["projector", "host"])
        elif not stalled and self.paused and self.pause_reason == "reconnect":
            self.resume()

    # ---- decisions & triggers ---------------------------------------------------------------------------------
    def _with_decisions(self, phase: str, then: Callable[[], None]) -> None:
        m = self.match
        assert m
        reqs = m.decisions_before(phase)
        if not reqs:
            then()
            return
        remaining = {"n": len(reqs)}
        turn_no, match_id = m.turn_no, m.match_id
        def make_cb(req: DecisionRequest):
            def cb(option: Option, source: str, line: str | None, latency_ms: float) -> None:
                if self.match is not m or m.ended or m.turn_no != turn_no:
                    return  # stale
                m.apply_decision(req, option)
                self.loop.emit("agent.decision", {"agent_id": req.agent_id, "option_id": option.id, "label": option.label, "source": source, "line": line, "turn_no": turn_no, "latency_ms": round(latency_ms)}, to="all")
                if self.arena.store is not None:
                    self.arena.store.write("agent_decisions", {"match_id": match_id, "turn_no": turn_no, "agent_id": req.agent_id, "option_id": option.id, "source": source, "latency_ms": latency_ms, "line": line})
                for h in self.on_decision:
                    h(m, req, option, source, line)
                remaining["n"] -= 1
                if remaining["n"] == 0:
                    then()
            return cb
        for req in reqs:
            if self.decision_provider and self.state.toggles.get("persona", True):
                self.decision_provider(req, make_cb(req))
            else:
                make_cb(req)(req.default, "default", None, 0.0)

    def fire_trigger(self, name: str, data: dict[str, Any]) -> None:
        if not self.match:
            return
        for h in self.on_trigger:
            try:
                h(name, data, self.match)
            except Exception:
                log.exception("trigger handler failed")


def install(arena) -> GamesModule:
    return GamesModule(arena)
