"""Baseball: the House pitches on the server timeline; a swing's t_server is compared with the pitch's arrival.
A turn is one human at-bat (several pitches in one input window); after the third out the House bats its half."""
from __future__ import annotations

from typing import Any

from ..agents.pitcher import PitcherPolicy
from ..agents.policy import DecisionRequest, Option
from .base import Match, MarketSpec, TurnPlan, TurnResult

OUTCOME_ORDER = ["strikeout", "out", "foul", "single", "double", "home_run"]


def contact(dt_ms: float, W: float, swing_angle: float, pitch_height: float, power: float, rot_sign: int, rng) -> dict[str, Any]:
    """Spec §7.3: hit if |Δt| ≤ W; quality from timing and height; direction from timing; distance from power and quality."""
    if abs(dt_ms) > W:
        return {"result": "miss", "quality": 0.0, "dir": 0.0, "dist": 0.0, "dt_ms": round(dt_ms)}
    quality = (1 - abs(dt_ms) / W) * (1 - 0.6 * abs(swing_angle - pitch_height))
    direction = max(-1.0, min(1.0, -dt_ms / W + 0.3 * rot_sign))
    dist = max(0.0, min(1.0, power)) * (0.4 + 0.6 * quality)
    r = rng.random()
    if quality < 0.25:
        res = "foul" if r < 0.6 else "out"
    elif quality < 0.5:
        res = "out" if r < 0.55 else "single"
    elif quality < 0.75:
        res = "single" if r < 0.5 else ("double" if r < 0.8 else "out")
    else:
        res = "home_run" if dist > 0.8 else "double"
    return {"result": res, "quality": round(quality, 3), "dir": round(direction, 3), "dist": round(dist, 3), "dt_ms": round(dt_ms)}


class Side:
    def __init__(self, name: str):
        self.name = name
        self.runs = 0
        self.hits = 0
        self.outs = 0
        self.bases = [False, False, False]
        self.log: list[str] = []

    def advance(self, n: int) -> int:
        """Advance runners by n bases (batter included). Returns runs scored."""
        runs = 0
        runners = [True] + self.bases            # batter at "base 0"
        for i in range(len(runners) - 1, -1, -1):
            if runners[i]:
                dest = i + n
                if dest >= 4:
                    runs += 1
                else:
                    runners[dest] = True
                runners[i] = False if dest != i else runners[i]
        self.bases = runners[1:4]
        self.runs += runs
        return runs

    def new_inning(self) -> None:
        self.outs = 0
        self.bases = [False, False, False]

    def public(self) -> dict[str, Any]:
        return {"name": self.name, "runs": self.runs, "hits": self.hits, "outs": self.outs, "bases": list(self.bases)}


class BaseballMatch(Match):
    sport = "baseball"

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        g = self.config.get("game.baseball")
        self.innings, self.outs_per_half = int(g["innings"]), int(g["outs_per_half"])
        self.pitch_defs: dict[str, dict[str, float]] = dict(g["pitches"])
        self.policy = PitcherPolicy(self.tier.params)
        self.human = Side(", ".join(self.players.values()) or "Player")
        self.house = Side(self.tier.name)
        self.inning = 1
        self.sudden_death = bool(self.tier.params.get("sudden_death", False))
        self.scenario_pitches = list(self.scenario.get("pitches", []))
        self.pitch_no = 0
        self.pitch: dict[str, Any] | None = None      # the pitch in flight (public fields)
        self.arrival_ts: float | None = None            # nominal arrival, ms server time
        self.actual_arrival: float | None = None        # with late break
        self.next_release_at: float | None = None
        self.strikes = 0
        self.at_bat_over = False
        self.at_bat_result: dict[str, Any] | None = None
        self.swung = False
        self.events: list[dict[str, Any]] = []
        self.house_ticks: list[dict[str, Any]] = []
        self.pitch_gap_s = float(g.get("pitch_gap_s", 2.5))
        self.last_swing_dt: float | None = None
        self.dts: list[float] = []

    # ---- turn = one human at-bat ------------------------------------------------------------------
    def plan_turn(self) -> TurnPlan | None:
        if self.inning > self.innings or (self.sudden_death and self.at_bat_result and self.at_bat_result.get("sudden_death_over")):
            return None
        self.strikes, self.at_bat_over, self.at_bat_result, self.pitch, self.arrival_ts, self.swung = 0, False, None, None, None, False
        self.next_release_at = None
        self.events, self.house_ticks = [], []
        label = f"Inning {self.inning} · {self.human.name} at bat"
        plan = TurnPlan(label=label, input_seats=list(self.seats), input_window_s=float(self.config.get("game.baseball.at_bat_window_s", 45)),
                        markets=[MarketSpec("turn_outcome", f"{label}", [("hit", "Hit"), ("out", "Out")])],
                        prompt={"inning": self.inning, "outs": self.human.outs, "bases": list(self.human.bases), "sudden_death": self.sudden_death})
        plan.tick_ms = 100.0  # type: ignore[attr-defined]
        return plan

    def decisions_before(self, phase: str) -> list[DecisionRequest]:
        if phase != "input":
            return []
        state = {"inning": self.inning, "human_runs": self.human.runs, "house_runs": self.house.runs, "outs": self.human.outs,
                 "mean_dt_ms": self.policy.mean_dt, "swing_rate": round(self.policy.swing_rate, 2)}
        opts = self.policy.options(state, self.rng)
        return [DecisionRequest(agent_id=f"house:baseball:{self.tier.id}", options=opts, default=self.policy.default(opts, self.rng), context=state, turn_no=self.turn_no, match_id=self.match_id)]

    def apply_decision(self, req: DecisionRequest, option: Option) -> None:
        self.policy.mode = str(option.params.get("mode", "mix"))

    def on_gesture(self, seat_id: str, gesture) -> bool:
        if gesture.kind != "swing" or self.at_bat_over:
            return False
        if self.pitch is None or self.actual_arrival is None or self.swung:
            self.events.append({"kind": "swing", "result": "early", "no_pitch": True})
            return True
        self.swung = True
        dt = float(gesture.t_server) - float(self.actual_arrival)
        W = self.param("W_ms", 90)
        angle = float(gesture.extra.get("pitch_angle", 0.5))
        rot = int(gesture.sign or 1)
        c = contact(dt, W, angle, float(self.pitch["height"]), float(gesture.power), rot, self.rng)
        self.policy.observe(dt)
        self.last_swing_dt = dt
        self.dts.append(dt)
        self._resolve_pitch(c, swung=True)
        return True

    def input_done(self) -> bool:
        return self.at_bat_over

    def no_input(self) -> None:
        if not self.at_bat_over:
            self.at_bat_result = {"result": "strikeout", "reason": "no_swing"}
            self.human.outs += 1
            self.at_bat_over = True

    def step(self, dt_s: float | None = None, now: float | None = None) -> dict[str, Any]:
        """Called every 100 ms during the at-bat: releases pitches and calls missed ones."""
        self.events = []
        if now is None or self.at_bat_over:
            return self.tick_summary(now)
        now_ms = now * 1000
        if self.pitch is None:
            if self.next_release_at is None:
                self.next_release_at = now_ms + 1500
            if now_ms >= self.next_release_at:
                self._release(now_ms)
        else:
            W = self.param("W_ms", 90)
            if now_ms > float(self.actual_arrival) + W + 60 and not self.swung:
                self.policy.observe(None)
                self._resolve_pitch({"result": "called", "quality": 0, "dir": 0, "dist": 0, "dt_ms": None}, swung=False)
        return self.tick_summary(now)

    def _release(self, now_ms: float) -> None:
        self.pitch_no += 1
        if self.scenario_pitches:
            kind = self.scenario_pitches[(self.pitch_no - 1) % len(self.scenario_pitches)]
        else:
            kind = self.policy.choose_pitch(self.rng)
        pd = self.pitch_defs.get(kind, self.pitch_defs["fastball"])
        speed_mult = self.param("speed_mult", 1.0)
        travel = float(pd["travel_ms"]) / max(0.5, speed_mult)
        late = self.rng.uniform(-90, 90) if pd.get("late_break") else 0.0
        self.arrival_ts = now_ms + travel
        self.actual_arrival = self.arrival_ts + late
        self.pitch = {"kind": kind, "release_ts": int(now_ms), "arrival_ts": int(self.arrival_ts), "travel_ms": int(travel), "height": float(pd["height"]),
                      "brk": float(pd["brk"]), "late_break_ms": int(late), "no": self.pitch_no, "strikes": self.strikes}
        self.swung = False
        self.events.append({"kind": "pitch", **self.pitch})

    def _resolve_pitch(self, c: dict[str, Any], swung: bool) -> None:
        res = c["result"]
        ev = {"kind": "result", "pitch_no": self.pitch_no, "swung": swung, **c}
        if res in ("miss", "called"):
            self.strikes += 1
            ev["strikes"] = self.strikes
            if self.strikes >= 3:
                self.at_bat_result = {"result": "strikeout", "reason": "swinging" if swung else "looking"}
                self.human.outs += 1
                self.at_bat_over = True
        elif res == "foul":
            if self.strikes < 2:
                self.strikes += 1
            ev["strikes"] = self.strikes
        elif res == "out":
            self.at_bat_result = {"result": "out", **c}
            self.human.outs += 1
            self.at_bat_over = True
        else:
            bases = {"single": 1, "double": 2, "home_run": 4}[res]
            runs = self.human.advance(bases)
            self.human.hits += 1
            self.at_bat_result = {"result": res, "runs": runs, **c}
            self.at_bat_over = True
        self.events.append(ev)
        if not self.at_bat_over:
            gap_from = float(self.actual_arrival or 0)
            self.pitch, self.arrival_ts, self.actual_arrival = None, None, None
            self.next_release_at = gap_from + self.pitch_gap_s * 1000
        else:
            self.pitch = None

    def tick_summary(self, now: float | None = None) -> dict[str, Any]:
        d = {"inning": self.inning, "batter": self.seats[0] if self.seats else None, "pitch": self.pitch, "pitch_no": self.pitch_no, "arrival_ts": self.arrival_ts,
             "strikes": self.strikes, "human": self.human.public(), "house": self.house.public(), "events": list(self.events), "at_bat_over": self.at_bat_over,
             "sudden_death": self.sudden_death, "flags": {}}
        for e in self.events:
            if e.get("kind") == "result" and e.get("result") == "home_run":
                d["flags"] = {"shake": True, "hitstop": True}
            elif e.get("kind") == "result" and e.get("result") in ("single", "double"):
                d["flags"] = {"shake": True}
        return d

    # ---- resolution: settle the at-bat; after 3 outs the House bats ---------------------------------------------
    def resolve(self) -> TurnResult:
        r = self.at_bat_result or {"result": "strikeout"}
        outcome = r["result"]
        hit = outcome in ("single", "double", "home_run")
        ticks: list[dict[str, Any]] = []
        triggers: list[tuple[str, dict[str, Any]]] = []
        player = self.human.name
        if outcome == "home_run":
            triggers.append(("home_run", {"player": player}))
        elif hit:
            triggers.append(("turn_result", {"outcome": outcome.replace("_", " ").title(), "player": player}))
        else:
            triggers.append(("taunt", {"outcome": outcome}))
        sudden_over = False
        if self.sudden_death:                     # The Closer: any out ends it for the House; a run wins it for the human
            if not hit:
                sudden_over = True
                self.house.runs = max(self.house.runs, self.human.runs + 1)
            elif r.get("runs", 0) > 0:
                sudden_over = True
        if self.human.outs >= self.outs_per_half and not sudden_over:
            ticks.extend(self._house_half())
            self.human.new_inning()
            self.inning += 1
        anim = 2.2 + sum(t.get("anim_s", 1.5) for t in ticks)
        detail = {"at_bat": r, "inning": self.inning, "sudden_death_over": sudden_over, "house_half": [t.get("result") for t in ticks]}
        if sudden_over:
            self.at_bat_result = dict(r, sudden_death_over=True)
            self.inning = self.innings + 1
        return TurnResult(outcome="hit" if hit else "out", detail=detail, score=self.summary(), market_winners={"turn_outcome": ["hit" if hit else "out"]},
                          triggers=triggers, animation_s=anim, ticks=ticks)

    def _house_half(self) -> list[dict[str, Any]]:
        """The House bats: each at-bat resolves from the tier's timing distribution."""
        ticks = []
        self.house.new_inning()
        sigma = float(self.tier.params.get("house_dt_sigma_ms", 60))
        W = 90.0
        n = 0
        while self.house.outs < self.outs_per_half and n < 12:
            n += 1
            dt = self.rng.gauss(0, sigma)
            c = contact(dt, W, 0.5, self.rng.uniform(0.3, 0.7), self.rng.uniform(0.5, 1.0), 1, self.rng)
            res = c["result"]
            runs = 0
            if res in ("miss", "foul", "out"):
                self.house.outs += 1
                res = "out"
            else:
                runs = self.house.advance({"single": 1, "double": 2, "home_run": 4}[res])
                self.house.hits += 1
            ticks.append({"who": "house", "result": res, "runs": runs, "dir": c["dir"], "dist": c["dist"], "house": self.house.public(), "anim_s": 1.6 if res != "home_run" else 2.4,
                          "flags": {"shake": res == "home_run"}})
        return ticks

    def summary(self) -> dict[str, Any]:
        return {"inning": min(self.inning, self.innings), "innings": self.innings, "human": self.human.public(), "house": self.house.public(),
                "sudden_death": self.sudden_death, "mean_dt_ms": round(self.policy.mean_dt, 1) if self.policy.mean_dt is not None else None}

    def winner(self) -> str:
        if self.human.runs != self.house.runs:
            return "human" if self.human.runs > self.house.runs else "house"
        return "tie" if not self.sudden_death else "house"
