"""PythonGameClient: drives the existing Python engines over the game-client contract. Lets the bridge be tested (and the
demo run) without the Phaser client: scripts/fake_game.py speaks it over a WebSocket, tests speak it in-process."""
from __future__ import annotations

import itertools
from typing import Any, Callable

from ..agents.policy import DecisionRequest, Option, TierConfig
from .wiring import match_class

_rid = itertools.count(1)


class PythonGameClient:
    def __init__(self, config, send: Callable[[str, dict[str, Any]], None], now_ms: Callable[[], float]):
        self.config, self.send, self.now_ms = config, send, now_ms
        self.match = None
        self.plan = None
        self.turn_no = 0
        self.pending: dict[str, DecisionRequest] = {}
        self._after_decisions: Callable[[], None] | None = None
        self.input_deadline_ms: float | None = None
        self.paused = False
        self.log: list[dict[str, Any]] = []
        self.live = False

    # ---- inbound from the arena --------------------------------------------------------------------------
    def handle(self, t: str, d: dict[str, Any]) -> None:
        if t == "game.start":
            self.start(d)
        elif t == "game.turn_go":
            self.enter_input()
        elif t == "game.gesture":
            self.gesture(d)
        elif t == "game.decision":
            self.decision(d)
        elif t == "game.adjust":
            self.adjust(d)
        elif t == "game.pause":
            self.paused = True
        elif t == "game.resume":
            self.paused = False
        elif t == "game.abort":
            self.match = None

    def start(self, d: dict[str, Any]) -> None:
        sport = d["sport"]
        tier = TierConfig.from_dict(sport, {"id": d["tier"]["id"], "name": d["tier"]["name"], "params": d["tier"]["params"], "accent": d["tier"].get("accent", ""), "twist": d["tier"].get("twist"), "taunts": d["tier"].get("taunts", [])})
        seats = [s["seat_id"] for s in d.get("seats", [])]
        players = d.get("players", {})
        kwargs: dict[str, Any] = {}
        if d.get("card"):
            kwargs["card"] = (d["tier"]["id"], d["tier_b"]["id"])
        self.match = match_class(sport)(d["match_id"], int(d["seed"]), tier, seats, players, self.config, d.get("scenario") or {}, **kwargs)
        self.match.adjustments.update(d.get("adjustments", {}))
        self.turn_no = 0
        self.log = []
        self.send("game.hello_ack", {}) if False else None
        self.plan_turn()

    def plan_turn(self) -> None:
        m = self.match
        if m is None:
            return
        plan = m.plan_turn()
        if plan is None:
            self.send("game.match_end", {"winner": m.winner(), "score": m.summary(), "reason": "complete"})
            self.match = None
            return
        self.turn_no += 1
        m.turn_no = self.turn_no
        self.plan = plan
        self.send("game.turn_open", {"turn_no": self.turn_no, "label": plan.label, "betting": plan.betting, "input_window_s": plan.input_window_s,
                                     "markets": [{"kind": s.kind, "label": s.label, "outcomes": [list(o) for o in s.outcomes], "seed_stake": s.seed_stake} for s in plan.markets],
                                     "prompt": plan.prompt})

    def _with_decisions(self, phase: str, then: Callable[[], None]) -> None:
        m = self.match
        reqs = m.decisions_before(phase) if m else []
        if not reqs:
            then()
            return
        self._after_decisions = then
        for req in reqs:
            rid = f"r{next(_rid)}"
            self.pending[rid] = req
            self.send("game.decision_request", {"request_id": rid, "agent_id": req.agent_id, "options": [o.public() | {"params": o.params} for o in req.options], "default": req.default.id, "context": req.context})

    def decision(self, d: dict[str, Any]) -> None:
        req = self.pending.pop(d["request_id"], None)
        if req is None or self.match is None:
            return
        opt = next((o for o in req.options if o.id == d["option_id"]), req.default)
        self.match.apply_decision(req, opt)
        self.log.append({"t": self.now_ms(), "kind": "decision", "agent": req.agent_id, "option": opt.id})
        if not self.pending and self._after_decisions:
            cb, self._after_decisions = self._after_decisions, None
            cb()

    def enter_input(self) -> None:
        self._with_decisions("input", self._input_now)

    def _input_now(self) -> None:
        m, plan = self.match, self.plan
        if m is None or plan is None:
            return
        tick = float(getattr(plan, "tick_ms", 0) or 0)
        if not plan.input_seats and not tick:
            self.enter_resolving()
            return
        self.input_deadline_ms = self.now_ms() + plan.input_window_s * 1000
        self.live = tick > 0
        self.send("game.phase", {"turn_no": self.turn_no, "phase": "input", "deadline_ts": int(self.input_deadline_ms), "prompt": plan.prompt | {"label": plan.label}, "seat_id": plan.input_seats[0] if plan.input_seats else None})

    def step(self) -> None:
        """Call periodically (every ~50-100 ms) while an input window is open."""
        m, plan = self.match, self.plan
        if m is None or plan is None or self.input_deadline_ms is None or self.paused:
            return
        if self.live and hasattr(m, "step"):
            summary = m.step(now=self.now_ms() / 1000.0)
            self.send("game.state", summary | {"score": m.summary()})
            if m.input_done():
                self.input_deadline_ms = None
                self.enter_resolving()
                return
        if self.now_ms() >= self.input_deadline_ms:
            self.input_deadline_ms = None
            m.no_input()
            self.enter_resolving()

    def gesture(self, d: dict[str, Any]) -> None:
        m, plan = self.match, self.plan
        if m is None or plan is None or self.input_deadline_ms is None or self.paused or d.get("seat_id") not in plan.input_seats:
            return
        from ..motion.detectors import Gesture
        g = Gesture(d["kind"], t_phone=float(d.get("t_server", self.now_ms())), power=float(d.get("power", 0.7)), duration_ms=float(d.get("duration_ms", 80)), extra=dict(d.get("extra", {})))
        g.seat_id, g.device_id, g.t_server = d["seat_id"], d.get("device_id"), float(d.get("t_server", self.now_ms()))
        if not m.on_gesture(g.seat_id, g):
            return
        self.log.append({"t": g.t_server, "kind": "gesture", "seat": g.seat_id, "g": g.kind, "power": g.power, "extra": g.extra})
        if m.input_done():
            self.input_deadline_ms = None
            self.enter_resolving()
        else:
            prompt = m.next_prompt()
            if prompt is not None:
                self.send("game.phase", {"turn_no": self.turn_no, "phase": "input", "deadline_ts": int(self.input_deadline_ms), "prompt": prompt | {"label": plan.label}, "seat_id": plan.input_seats[0]})
                for t in getattr(m, "cur_ticks", [])[-1:]:
                    self.send("game.state", t | {"score": m.summary(), "live": True})

    def enter_resolving(self) -> None:
        self._with_decisions("resolving", self._resolve_now)

    def _resolve_now(self) -> None:
        m = self.match
        if m is None:
            return
        res = m.resolve()
        self.send("game.phase", {"turn_no": self.turn_no, "phase": "resolving", "deadline_ts": int(self.now_ms() + res.animation_s * 1000), "prompt": {}})
        for tick in res.ticks:
            self.send("game.state", tick | {"score": m.summary()})
        self.send("game.turn_result", {"turn_no": self.turn_no, "outcome": res.outcome, "market_winners": res.market_winners, "detail": res.detail, "score": res.score,
                                       "triggers": [[n, d] for n, d in res.triggers], "animation_s": res.animation_s})
        self.send("game.log", {"turn_no": self.turn_no, "entries": self.log})
        self.log = []
        self.send("game.phase", {"turn_no": self.turn_no, "phase": "between", "deadline_ts": None, "prompt": {}})
        self.plan_turn()

    def adjust(self, d: dict[str, Any]) -> None:
        m = self.match
        if m is None:
            return
        eff = d.get("effect") or {}
        if eff.get("grant") == "extra_frame" and hasattr(m, "grant_extra_frame"):
            m.grant_extra_frame()
        elif eff.get("grant") == "second_wind" and hasattr(m, "grant_second_wind"):
            m.grant_second_wind()
        elif d.get("param"):
            if d.get("reason") == "adaptive":
                m.adjustments[d["param"]] = float(d.get("delta", 0))
                from ..agents.adaptive import AdaptiveController
                AdaptiveController.apply(m, d["param"], float(d.get("delta", 0)))
            else:
                m.adjustments[d["param"]] = m.adjustments.get(d["param"], 0.0) + float(d.get("delta", 0))
                if m.sport == "bowling" and d["param"] == "lane_drift":
                    m.lane_drift += float(d.get("delta", 0))
