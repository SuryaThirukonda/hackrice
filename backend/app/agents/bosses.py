"""Boss twists. Boxing: the House Champ learns the challenger's punch rhythm and guards on the predicted beat.
Bowling (Pin King) and baseball (The Closer) twists live in their engines; this module wires the learner and reports the meter."""
from __future__ import annotations

import statistics
from collections import Counter, deque


class RhythmLearner:
    def __init__(self, arena=None, agent_id: str = "house:boxing:boss", keep: int = 8, min_n: int = 5, std_limit_s: float = 0.12, reset_dev: float = 0.4, lead_s: float = 0.1):
        self.arena, self.agent_id = arena, agent_id
        self.times: deque[float] = deque(maxlen=keep + 1)
        self.kinds: deque[str] = deque(maxlen=keep)
        self.min_n, self.std_limit, self.reset_dev, self.lead = min_n, std_limit_s, reset_dev, lead_s
        self.level = 0.0
        self.predicted: float | None = None
        self.guarded_until = 0.0
        self.hits_predicted = 0

    def intervals(self) -> list[float]:
        t = list(self.times)
        return [b - a for a, b in zip(t, t[1:])]

    def on_punch(self, t: float, kind: str) -> None:
        iv = self.intervals()
        if iv and self.times:
            last = t - self.times[-1]
            mean = sum(iv) / len(iv)
            if mean > 0 and abs(last - mean) / mean > self.reset_dev and len(iv) >= 2:
                self.times.clear(); self.kinds.clear()      # rhythm changed: start over
        self.times.append(t)
        self.kinds.append(kind)
        self._update()

    def _update(self) -> None:
        iv = self.intervals()
        if len(iv) >= 2:
            std = statistics.pstdev(iv)
            self.level = max(0.0, min(1.0, 1 - std / 0.3))
            if len(iv) + 1 >= self.min_n and std < self.std_limit:
                self.predicted = self.times[-1] + sum(iv) / len(iv)
            else:
                self.predicted = None
        else:
            self.level, self.predicted = 0.0, None
        if self.arena is not None:
            self.arena.state.studying["house:boxing"] = {"agent_id": self.agent_id, "level": round(self.level, 3), "param": "rhythm", "predicted": self.predicted is not None, "n": len(self.times)}
            self.arena.loop.emit("agent.studying", self.arena.state.studying["house:boxing"], to="all")

    def preferred_kind(self) -> str:
        return Counter(self.kinds).most_common(1)[0][0] if self.kinds else "jab"

    def guard_now(self, t: float) -> str | None:
        """Called every tick: 'block' or 'dodge' when a punch is predicted within lead_s, else None."""
        if self.predicted is None or t >= self.guarded_until and (self.predicted - self.lead) <= t <= self.predicted + 0.25:
            if self.predicted is not None and (self.predicted - self.lead) <= t <= self.predicted + 0.25 and t >= self.guarded_until:
                self.guarded_until = self.predicted + 0.4
                self.hits_predicted += 1
                return "dodge" if self.preferred_kind() == "hook" else "block"
        return None


def attach_boss(match, arena=None) -> None:
    """Install the sport's boss twist on a live match (called from the games driver at match start)."""
    if match.sport == "boxing" and match.tier.params.get("rhythm_learner") and getattr(match, "b", None) is not None and match.b.house:
        learner = RhythmLearner(arena, f"house:boxing:{match.tier.id}")
        match.on_human_punch = learner.on_punch
        match.rhythm = learner
