"""GameBridge: the arena side of the game-client contract (docs/ENGINE_ARCHITECTURE.md).
Installed under arena.modules["games.wiring"] when HAP_ENGINE=client so market, voice, persona, adaptive and sponsor
modules keep working unchanged. The Phaser client (or scripts/fake_game.py) drives turns; this module owns money, windows, records."""
from __future__ import annotations

import itertools
import logging
import random
from typing import Any, Callable

from ..agents.policy import DecisionRequest, Option, TierConfig
from ..arena import Intent
from ..motion.detectors import Gesture
from . import scripted

log = logging.getLogger("hap.bridge")
_ids = itertools.count(1)


class RemoteMatch:
    """Arena-side shadow of a match that lives in the game engine."""

    def __init__(self, bridge: "GameBridge", match_id: str, sport: str, seed: int, tier: TierConfig, seats: list[str], players: dict[str, str],
                 scenario: dict[str, Any], mode: str, card: bool, tier_b: TierConfig | None):
        self.bridge, self.match_id, self.sport, self.seed, self.tier, self.seats, self.players = bridge, match_id, sport, seed, tier, seats, players
        self.scenario, self.mode, self.card, self.tier_b = scenario, mode, card, tier_b
        self.turn_no, self.phase, self.ended = 0, "starting", False
        self.adjustments: dict[str, float] = {}
        self.sponsored_turn = False
        self.score: dict[str, Any] = {}
        self.lane_drift = 0.0
        self.rng = random.Random(seed)
        self.policy = None

    def summary(self) -> dict[str, Any]:
        return self.score

    def public(self) -> dict[str, Any]:
        return {"match_id": self.match_id, "sport": self.sport, "seed": self.seed, "human_seats": self.seats, "players": self.players,
                "opponent": self.tier.public(), "opponent_b": self.tier_b.public() if self.tier_b else None, "turn_no": self.turn_no, "phase": self.phase,
                "score": self.score, "scenario": bool(self.scenario), "mode": self.mode, "card": self.card, "engine": "client"}

    def winner_outcomes(self) -> list[tuple[str, str]]:
        if self.card:
            return [("a", self.tier.name), ("b", self.tier_b.name if self.tier_b else "B")]
        if self.mode == "2p" and len(self.seats) >= 2:
            return [(self.seats[0], self.players.get(self.seats[0], "A")), (self.seats[1], self.players.get(self.seats[1], "B"))]
        human = ", ".join(self.players.values()) or "Player"
        return [("human", human), ("house", self.tier.name)]

    # hooks used by adaptive/sponsor modules
    def send_adjust(self, param: str, delta: float, reason: str) -> None:
        self.adjustments[param] = delta
        self.bridge.to_game("game.adjust", {"param": param, "delta": delta, "reason": reason})

    def send_effect(self, eff: dict[str, Any]) -> None:
        self.bridge.to_game("game.adjust", {"param": eff.get("param"), "delta": eff.get("delta", 0.0), "reason": "sponsor", "effect": eff})

    def grant_extra_frame(self) -> None:
        pass  # sent through send_effect

    def grant_second_wind(self) -> None:
        pass


class GameBridge:
    def __init__(self, arena):
        self.arena = arena
        self.loop, self.state, self.config, self.rooms = arena.loop, arena.state, arena.config, arena.rooms
        self.market = arena.modules.get("market.wiring")
        self.motion = arena.modules.get("motion.worker")
        self.match: RemoteMatch | None = None
        self.phase = "idle"
        self.paused = False
        self.pause_reason: str | None = None
        self.turn_markets: dict[str, str] = {}
        self.match_market_id: str | None = None
        self.decision_provider: Callable | None = None
        self.on_turn_result: list = []
        self.on_match_start: list = []
        self.on_match_end: list = []
        self.on_trigger: list = []
        self.on_decision: list = []
        self.history: list[dict[str, Any]] = []
        self.game_conns: set[str] = set()
        self.active_conn: str | None = None     # only one game client drives matches; a newer hello takes over
        self._deadline = 0.0
        self._remaining: float | None = None
        handlers = {"game.hello": self.on_hello, "game.turn_open": self.on_turn_open, "game.phase": self.on_phase, "game.decision_request": self.on_decision_request,
                    "game.state": self.on_state, "game.turn_result": self.h_turn_result, "game.match_end": self.h_match_end, "game.log": self.on_log,
                    "game.kb": self.on_kb, "game.error": self.on_error, "game.request_start": self.on_request_start}
        for t, h in handlers.items():
            self.loop.on(t, h)
        self.loop.on("host.start", self.on_host_start)
        self.loop.on("host.card", self.on_host_card)
        self.loop.on("host.pause", lambda i: self.pause("host"))
        self.loop.on("host.resume", lambda i: self.resume())
        self.loop.on("host.next", lambda i: self.skip())
        self.loop.on("host.force_scenario", self.on_force_scenario)
        self.loop.on("session.disconnect", self.on_disconnect)
        if self.motion:
            self.motion.gesture_handlers.append(self.forward_gesture)
        self.loop.schedule_every(0.5, self.gap_check, key="match.gapcheck")

    # ---- connection -----------------------------------------------------------------------------------
    def to_game(self, t: str, d: dict[str, Any]) -> None:
        if self.active_conn and self.active_conn in self.loop.conns:
            self.loop.emit(t, d, to=("conn", self.active_conn))
        else:
            self.loop.emit(t, d, to="game")

    def on_hello(self, i: Intent) -> None:
        if i.conn_id:
            self.game_conns.add(i.conn_id)
            if self.active_conn and self.active_conn != i.conn_id and self.active_conn in self.loop.conns:
                self.loop.emit("game.abort", {"reason": "another game client took over"}, to=("conn", self.active_conn))
            self.active_conn = i.conn_id
        self.to_game("game.config", {"game": self.config.get("game", {}), "engine": self.config.engine})
        if self.match and not self.match.ended:
            self.to_game("game.start", self._start_payload(self.match) | {"resume": True})
        self.loop.emit("host.ack", {"cmd": "game_hello", "ok": True, "engine": i.d.get("engine", "client"), "version": i.d.get("version")}, to="host")

    def on_disconnect(self, i: Intent) -> None:
        if i.conn_id in self.game_conns:
            self.game_conns.discard(i.conn_id)
            if i.conn_id == self.active_conn:
                self.active_conn = next(iter(self.game_conns), None)
                if self.match and not self.match.ended:
                    self.end_match("engine_disconnected")

    def game_connected(self) -> bool:
        return bool(self.active_conn and self.active_conn in self.loop.conns) or any(c.role == "game" for c in self.loop.conns.values())

    # ---- starting --------------------------------------------------------------------------------------
    def tier_for(self, sport: str, tier_id: str | None) -> TierConfig:
        tiers = self.config.tiers(sport)
        d = next((t for t in tiers if t["id"] == tier_id), None) or tiers[0]
        return TierConfig.from_dict(sport, d)

    def human_seats(self) -> list[str]:
        return [s.seat_id for s in self.rooms.claimed_seats()]

    def on_host_start(self, i: Intent) -> None:
        try:
            self.start_match(i.d.get("sport", "bowling"), i.d.get("tier"), i.d.get("scenario"), i.d.get("seats"), seed=i.d.get("seed"), mode=i.d.get("mode", "1p"))
            self.loop.emit("host.ack", {"cmd": "start", "ok": True, "match_id": self.match.match_id if self.match else None}, to="host")
        except Exception as e:  # noqa: BLE001
            self.loop.emit("host.ack", {"cmd": "start", "ok": False, "reason": str(e)}, to=["host", "projector", "game"])

    def on_request_start(self, i: Intent) -> None:
        if i.conn_id:
            self.active_conn = i.conn_id     # whoever starts a match becomes the active client
        d = i.d
        try:
            if d["mode"] == "card":
                tiers = [t["id"] for t in self.config.tiers("boxing")]
                a = d.get("tier") or random.choice(tiers)
                b = d.get("tier_b") or random.choice([t for t in tiers if t != a])
                self.start_match("boxing", a, d.get("scenario"), None, card=True, tiers=(a, b))
            else:
                seat_mode = "head_to_head" if d["mode"] == "2p" else "single"
                self.start_match(d["sport"], d.get("tier"), d.get("scenario"), seat_mode, mode=d["mode"], tier_b_id=d.get("tier_b"))
            self.loop.emit("host.ack", {"cmd": "start", "ok": True, "match_id": self.match.match_id, "from": "game"}, to="host")
        except Exception as e:  # noqa: BLE001
            self.to_game("game.abort", {"reason": str(e)})
            self.loop.emit("host.ack", {"cmd": "start", "ok": False, "reason": str(e), "from": "game"}, to="host")

    def on_host_card(self, i: Intent) -> None:
        if i.d.get("a"):
            self.start_match("boxing", i.d["a"], None, None, card=True, tiers=(i.d["a"], i.d.get("b") or i.d["a"]))

    def on_force_scenario(self, i: Intent) -> None:
        if i.d.get("kind") == "demo":
            try:
                self.start_match(i.d.get("sport", "bowling"), i.d.get("tier"), "demo", None)
            except Exception as e:  # noqa: BLE001
                self.loop.emit("host.ack", {"cmd": "force_scenario", "ok": False, "reason": str(e)}, to="host")

    def _seat_mode(self) -> str:
        ids = tuple(self.state.seats)
        return {("P1",): "single", ("L", "R"): "two_glove", ("A", "B"): "head_to_head", ("ACTIVE", "BENCH"): "tag_team", (): "none"}.get(ids, "custom")

    def start_match(self, sport: str, tier_id: str | None = None, scenario: str | None = None, seat_mode: str | None = None, seed: int | None = None,
                    card: bool = False, tiers: tuple[str, str] | None = None, mode: str = "1p", tier_b_id: str | None = None) -> RemoteMatch:
        if not self.game_connected():
            raise ValueError("game client not connected: open the projector")
        if self.match and not self.match.ended:
            self.end_match("replaced")
        if seat_mode and seat_mode != self._seat_mode():
            self.rooms.configure_seats(seat_mode)
        seats = [] if card else self.human_seats()
        if mode == "2p":
            seats = [s for s in ("A", "B") if s in self.state.seats and self.state.seats[s].status == "claimed"]
            if len(seats) < 2:
                raise ValueError("two players must be seated (keyboard or phone) for 2P")
        elif not card and not seats:
            raise ValueError("no player seated: choose keyboard or scan a seat QR")
        players = {s: (self.state.seats[s].nickname or f"Player {s}") for s in seats}
        sc = scripted.load(sport, scenario)
        if self.config.mode == "scripted" and not sc:
            sc = scripted.load(sport, "demo")
        seed = seed if seed is not None else int(sc.get("seed", random.randrange(1, 2**31)))
        if card:
            ta, tb = tiers or ("champion", "boss")
            tier, tier_b = self.tier_for("boxing", ta), self.tier_for("boxing", tb)
            mode = "card"
        else:
            tier = self.tier_for(sport, tier_id)
            tier_b = self.tier_for(sport, tier_b_id) if tier_b_id else None
        match_id = f"m_{next(_ids)}"
        self.match = RemoteMatch(self, match_id, sport, seed, tier, seats, players, sc, mode, card, tier_b)
        self.loop.match_id = match_id
        self.turn_markets = {}
        self.phase = "starting"
        self.state.match = self.match.public()
        self.state.studying = {}
        if self.motion:
            self.motion.set_sport(sport)
        if self.arena.store is not None:
            self.arena.store.write("matches", {"match_id": match_id, "sport": sport, "seed": seed, "opponent_tier": tier.id, "scenario": scenario, "started_ts": self.loop.clock.now(), "ended_ts": None, "winner": None})
        self.loop.emit("match.start", self.match.public(), to="all")
        self.fire_trigger("match_start", {"player": ", ".join(players.values()) or "The House", "opponent": tier.name})
        if self.market:
            label = "Fight" if card else "Match winner"
            outs = self.match.winner_outcomes()
            seed_stake = {"house": 300} if (sport == "baseball" and tier.params.get("sudden_death")) else None
            m = self.market.open_market(match_id, "match_winner", f"{label}: {outs[0][1]} vs {outs[1][1]}", outs, window_s=float(self.config.get("market.windows.betting_s", 12)) + 6, seed_stake=seed_stake)
            self.match_market_id = m.market_id
        self.to_game("game.start", self._start_payload(self.match))
        for cb in self.on_match_start:
            cb(self.match)
        return self.match

    def _start_payload(self, m: RemoteMatch) -> dict[str, Any]:
        return {"match_id": m.match_id, "sport": m.sport, "seed": m.seed, "mode": m.mode, "card": m.card,
                "tier": {"id": m.tier.id, "name": m.tier.name, "params": m.tier.params, "accent": m.tier.accent, "twist": m.tier.twist, "taunts": m.tier.taunts},
                "tier_b": ({"id": m.tier_b.id, "name": m.tier_b.name, "params": m.tier_b.params, "accent": m.tier_b.accent, "twist": m.tier_b.twist} if m.tier_b else None),
                "players": m.players, "seats": [self.state.seats[s].public(self.state.public_url) for s in m.seats if s in self.state.seats],
                "scenario": m.scenario, "adjustments": m.adjustments, "game": self.config.get("game", {}),
                "betting_s": float(self.config.get("market.windows.betting_s", 12)), "between_s": float(self.config.get("market.windows.between_s", 2))}

    # ---- turn flow driven by the game ---------------------------------------------------------------------
    def on_turn_open(self, i: Intent) -> None:
        m = self.match
        if not m or m.ended:
            return
        d = i.d
        m.turn_no = int(d["turn_no"])
        self.turn_markets = {}
        betting_s = float(self.config.get("market.windows.betting_s", 12))
        if d.get("betting", True) and self.market and d.get("markets"):
            for spec in d["markets"]:
                outs = [tuple(o) for o in spec.get("outcomes", [])]
                mk = self.market.open_market(m.match_id, spec.get("kind", "turn_outcome"), spec.get("label", d.get("label", "")), outs, window_s=betting_s, turn_no=m.turn_no, seed_stake=spec.get("seed_stake"))
                self.turn_markets[spec.get("kind", "turn_outcome")] = mk.market_id
            self._set_phase("betting", betting_s, {"label": d.get("label")})
            self.loop.schedule_in(betting_s, self._turn_go, key="match.phase")
        else:
            self._turn_go()
        m.sponsored_turn = False

    def _turn_go(self) -> None:
        m = self.match
        if not m or m.ended or self.paused:
            return
        if self.match_market_id and self.market and m.turn_no == 1:
            self.market.close_market(self.match_market_id)
        for mid in self.turn_markets.values():
            if self.market:
                self.market.close_market(mid)
        self.to_game("game.turn_go", {"turn_no": m.turn_no, "server_ts": self.loop.clock.now_ms()})

    def on_phase(self, i: Intent) -> None:
        m = self.match
        if not m or m.ended:
            return
        d = i.d
        self.phase = d["phase"]
        m.phase = d["phase"]
        self.state.match = m.public() | {"deadline_ts": d.get("deadline_ts")}
        self.loop.emit("match.phase", {"turn_no": d["turn_no"], "phase": d["phase"], "deadline_ts": d.get("deadline_ts"), "prompt": d.get("prompt", {}), "seat_id": d.get("seat_id"), "label": d.get("prompt", {}).get("label")}, to="all")

    def _set_phase(self, phase: str, secs: float, extra: dict[str, Any] | None = None) -> None:
        m = self.match
        assert m
        self.phase, m.phase = phase, phase
        self._deadline = self.loop.clock.now() + secs
        self.state.match = m.public() | {"deadline_ts": int(self._deadline * 1000)}
        self.loop.emit("match.phase", {"turn_no": m.turn_no, "phase": phase, "deadline_ts": int(self._deadline * 1000), "seat_id": m.seats[0] if m.seats else None, **(extra or {})}, to="all")

    def on_decision_request(self, i: Intent) -> None:
        m = self.match
        if not m or m.ended:
            return
        d = i.d
        opts = [Option(o["id"], o.get("label", o["id"]), dict(o.get("params", {})), float(o.get("ev", 0))) for o in d["options"]]
        default = next((o for o in opts if o.id == d["default"]), opts[0])
        req = DecisionRequest(agent_id=d["agent_id"], options=opts, default=default, context=d.get("context", {}), turn_no=m.turn_no, match_id=m.match_id)
        rid, turn_no = d["request_id"], m.turn_no
        def cb(option: Option, source: str, line: str | None, latency_ms: float) -> None:
            if self.match is not m or m.ended:
                return
            self.to_game("game.decision", {"request_id": rid, "option_id": option.id, "source": source, "line": line})
            self.loop.emit("agent.decision", {"agent_id": req.agent_id, "option_id": option.id, "label": option.label, "source": source, "line": line, "turn_no": turn_no, "latency_ms": round(latency_ms)}, to="all")
            if self.arena.store is not None:
                self.arena.store.write("agent_decisions", {"match_id": m.match_id, "turn_no": turn_no, "agent_id": req.agent_id, "option_id": option.id, "source": source, "latency_ms": latency_ms, "line": line})
            for h in self.on_decision:
                h(m, req, option, source, line)
        if self.decision_provider and self.state.toggles.get("persona", True):
            self.decision_provider(req, cb)
        else:
            cb(default, "default", None, 0.0)

    def on_state(self, i: Intent) -> None:
        m = self.match
        if not m or m.ended:
            return
        m.score = i.d.get("score", m.score)
        self.state.match = m.public()
        self.loop.emit("match.tick", i.d, to=["projector", "remote", "rail"])

    def h_turn_result(self, i: Intent) -> None:
        m = self.match
        if not m or m.ended:
            return
        d = i.d
        m.score = d.get("score", m.score)
        self.loop.cancel("match.phase")
        self.state.match = m.public()
        self.loop.emit("match.turn_result", {"turn_no": d["turn_no"], "outcome": d["outcome"], "detail": d.get("detail", {}), "score": m.score}, to="all")
        self.history.append({"turn_no": d["turn_no"], "outcome": d["outcome"], "detail": d.get("detail", {})})
        if self.arena.store is not None:
            self.arena.store.write("turns", {"match_id": m.match_id, "turn_no": d["turn_no"], "phase_ts_json": {"resolved": self.loop.clock.now()}, "outcome": d["outcome"], "detail_json": d.get("detail", {})})
        if self.market:
            for kind, winners in d.get("market_winners", {}).items():
                mid = self.turn_markets.get(kind)
                if mid:
                    self.market.settle(mid, winners, {"turn_no": d["turn_no"], "outcome": d["outcome"]})
        for name, data in d.get("triggers", []):
            self.fire_trigger(name, data if isinstance(data, dict) else {})
        class _Res:  # shape expected by adaptive/sponsor callbacks
            outcome = d["outcome"]
            detail = d.get("detail", {})
        for cb in self.on_turn_result:
            cb(m, _Res())
        m.sponsored_turn = False

    def h_match_end(self, i: Intent) -> None:
        m = self.match
        if not m or m.ended:
            return
        m.score = i.d.get("score", m.score)
        self.end_match(i.d.get("reason", "complete"), i.d.get("winner"))

    def on_log(self, i: Intent) -> None:
        if self.arena.store is not None and self.match:
            self.arena.store.write("game_log", {"match_id": self.match.match_id, "turn_no": i.d.get("turn_no"), "entries_json": i.d.get("entries", []), "ts": self.loop.clock.now()})

    def on_error(self, i: Intent) -> None:
        self.loop.emit("host.ack", {"cmd": "game_error", "ok": False, "reason": i.d.get("message", "")}, to="host")

    # ---- keyboard on the projector (game client native input) ------------------------------------------------------------
    def on_kb(self, i: Intent) -> None:
        seat_id = i.d.get("seat_id", "P1")
        seat = self.state.seats.get(seat_id)
        if seat is None:
            return
        dev_id = f"kb:{seat_id}"
        from ..state import Device
        dev = self.state.devices.get(dev_id)
        if dev is None:
            dev = Device(device_id=dev_id, role="remote", nickname=f"Keyboard {seat_id}" if len(self.state.seats) > 1 else "Keyboard", connected=True, calibrated=True, first_seen=self.loop.clock.now())
            self.state.devices[dev_id] = dev
            for cb in self.rooms.on_join:
                cb(dev)
        dev.connected, dev.calibrated, dev.last_seen = True, True, self.loop.clock.now()
        if seat.status == "open" or (seat.status == "claimed" and seat.device_id == dev_id):
            if seat.status == "open":
                seat.status, seat.device_id, seat.nickname, seat.claimed_ts = "claimed", dev_id, dev.nickname, self.loop.clock.now()
                dev.seat_id = seat_id
                self.rooms.emit_seats()
                for cb in self.rooms.on_seat_change:
                    cb(seat, "claimed")
        elif seat.device_id != dev_id:
            return  # a phone holds this seat
        kind, params = i.d["kind"], dict(i.d.get("params", {}))
        if kind == "claim":
            return
        g = Gesture(kind, t_phone=float(self.loop.clock.now_ms()), power=float(params.pop("power", 0.7)), extra=params)
        g.device_id, g.seat_id, g.t_server = dev_id, seat_id, float(self.loop.clock.now_ms())
        self.loop.emit("motion.gesture", g.to_dict() | {"source": "client_kb"}, to=["projector", "host"])
        if self.motion:
            for h in self.motion.gesture_handlers:
                if h is not self.forward_gesture:
                    h(g)

    def forward_gesture(self, g: Gesture) -> None:
        if not self.match or self.match.ended or g.seat_id is None:
            return
        self.to_game("game.gesture", {"seat_id": g.seat_id, "kind": g.kind, "power": g.power, "t_server": g.t_server, "duration_ms": g.duration_ms, "extra": g.extra, "device_id": g.device_id})

    # ---- end / pause ------------------------------------------------------------------------------------------------
    def end_match(self, reason: str, winner: str | None = None) -> None:
        m = self.match
        if not m or m.ended:
            return
        m.ended = True
        self.loop.cancel("match.phase")
        if reason != "complete":
            self.to_game("game.abort", {"reason": reason})
            winner = "void"
        winner = winner or "void"
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
        if winner == "human" or (m.mode == "2p" and winner in m.players):
            for seat, nick in m.players.items():
                if m.mode == "2p" and seat != winner:
                    continue
                lad = self.state.ladder.setdefault(nick, {})
                tiers = [t["id"] for t in self.config.tiers(m.sport)]
                lad[m.sport] = max(lad.get(m.sport, 0), tiers.index(m.tier.id) + 1 if m.tier.id in tiers else 1)
            self.loop.emit("ladder.update", {"ladder": self.state.ladder}, to="all")
        self.state.match = m.public() | {"winner": winner, "reason": reason}
        self.phase = "ended"
        if self.arena.store is not None:
            self.arena.store.write("matches", {"match_id": m.match_id, "sport": m.sport, "seed": m.seed, "opponent_tier": m.tier.id, "scenario": None, "started_ts": None, "ended_ts": self.loop.clock.now(), "winner": winner})
        self.loop.emit("match.end", {"match_id": m.match_id, "winner": winner, "reason": reason, "score": m.score, "players": m.players, "opponent": m.tier.public(), "ladder": self.state.ladder, "mode": m.mode}, to="all")
        if reason == "complete":
            names = {"human": ", ".join(m.players.values()), "house": m.tier.name, "a": m.tier.name, "b": m.tier_b.name if m.tier_b else "B", "tie": "Nobody"}
            self.fire_trigger("match_end", {"winner": names.get(winner, m.players.get(winner, winner))})
        for cb in self.on_match_end:
            cb(m, winner)
        if self.motion:
            self.motion.set_sport("idle")
        self.loop.match_id = None

    def skip(self) -> None:
        if self.match and not self.match.ended:
            self.end_match("skipped")

    def pause(self, reason: str) -> None:
        if not self.match or self.match.ended or self.paused:
            return
        self.paused, self.pause_reason = True, reason
        self._remaining = max(0.0, self._deadline - self.loop.clock.now()) if self.loop.has_timer("match.phase") else None
        self.loop.cancel("match.phase")
        self.state.match = self.match.public() | {"paused": True}
        self.loop.emit("match.pause", {"paused": True, "reason": reason}, to="all")
        self.to_game("game.pause", {"reason": reason})

    def resume(self) -> None:
        if not self.match or not self.paused:
            return
        self.paused, self.pause_reason = False, None
        self.state.match = self.match.public() | {"paused": False}
        self.loop.emit("match.pause", {"paused": False}, to="all")
        if self._remaining is not None:
            self._deadline = self.loop.clock.now() + self._remaining
            self.loop.schedule_in(self._remaining, self._turn_go, key="match.phase")
        self.to_game("game.resume", {})

    def gap_check(self) -> None:
        m = self.match
        if not m or m.ended or not m.seats:
            return
        gap_s = float(self.config.get("motion.frame_gap_pause_ms", 1500)) / 1000
        now = self.loop.clock.now()
        stalled = []
        for seat_id in m.seats:
            seat = self.state.seats.get(seat_id)
            dev = self.state.devices.get(seat.device_id) if seat and seat.device_id else None
            streaming = dev is not None and dev.hz > 0
            if dev is None or (not dev.connected and not dev.device_id.startswith("kb:")) or (streaming and dev.last_frame_ts and now - dev.last_frame_ts > gap_s):
                stalled.append(seat_id)
        if stalled and not self.paused and self.phase in ("input", "betting"):
            self.pause("reconnect")
        elif not stalled and self.paused and self.pause_reason == "reconnect":
            self.resume()

    def fire_trigger(self, name: str, data: dict[str, Any]) -> None:
        if not self.match:
            return
        for h in self.on_trigger:
            try:
                h(name, data, self.match)
            except Exception:
                log.exception("trigger handler failed")


def install(arena) -> GameBridge:
    return GameBridge(arena)
