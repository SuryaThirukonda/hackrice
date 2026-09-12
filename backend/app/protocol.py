"""Wire protocol: one JSON envelope both ways, a frozen message catalog.

Server -> client: {"t": type, "seq": int, "match": match_id|None, "ts": epoch_ms, "d": payload}
Client -> server: {"t": type, "cseq": int, "d": payload}

Motion sample layout (13 numbers): [t_phone_ms, ax, ay, az, agx, agy, agz, rx, ry, rz, alpha, beta, gamma]
  a*  = acceleration without gravity (m/s^2), ag* = including gravity, r* = rotationRate (deg/s),
  alpha/beta/gamma = orientation angles (deg). t_phone_ms = performance.timeOrigin + event.timeStamp.
"""
from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

SAMPLE_LEN = 13
Role = Literal["remote", "rail", "projector", "host"]
ROLES: tuple[str, ...] = ("remote", "rail", "projector", "host")


class Payload(BaseModel):
    model_config = ConfigDict(extra="allow")


class Hello(Payload):
    role: Role
    device_id: str = Field(min_length=4, max_length=64)
    token: str | None = None
    nickname: str | None = Field(default=None, max_length=24)
    ua: str | None = Field(default=None, max_length=300)
    time_origin: float | None = None
    last_seq: int | None = None


class Ping(Payload):
    t_client: float
    rtt_ms: float = 0.0


class Resync(Payload):
    last_seq: int = 0


class MotionFrame(Payload):
    t0: float
    n: int
    s: list[list[float]]


class Bet(Payload):
    market_id: str
    outcome_id: str
    stake: int = Field(ge=1)


class SponsorBuy(Payload):
    move_id: str
    target: Literal["house", "human"] | None = None


class CardVote(Payload):
    pairing_id: str


class CrateBid(Payload):
    amount: int = Field(ge=1)


class PairRequest(Payload):
    kind: Literal["pass_seat", "transfer", "bind_glove", "tag"]
    amount: int | None = None
    seat_id: str | None = None


class SetNickname(Payload):
    nickname: str = Field(min_length=1, max_length=24)


class InputAction(Payload):
    """Direct input from a keyboard remote (desktop testing): bypasses the motion detectors."""
    kind: Literal["swing", "release", "punch", "block_on", "block_off", "dodge", "parry", "move", "bump", "shake", "flick"]
    params: dict[str, Any] = Field(default_factory=dict)
    t_client: float | None = None


# Every client message type and the model that validates its payload.
CLIENT_MESSAGES: dict[str, type[Payload]] = {
    "session.hello": Hello,
    "session.ping": Ping,
    "session.resync": Resync,
    "session.nickname": SetNickname,
    "motion.frame": MotionFrame,
    "motion.calib_done": Payload,
    "input.action": InputAction,
    "market.bet": Bet,
    "sponsor.buy": SponsorBuy,
    "crate.bid": CrateBid,
    "card.vote": CardVote,
    "pair.request": PairRequest,
    "host.telemetry": Payload,
    "host.start": Payload,
    "host.pause": Payload,
    "host.resume": Payload,
    "host.next": Payload,
    "host.force_scenario": Payload,
    "host.set_param": Payload,
    "host.kick": Payload,
    "host.release_seat": Payload,
    "host.lock_seat": Payload,
    "host.set_public_url": Payload,
    "host.reload_config": Payload,
    "host.toggle": Payload,
    "host.set_seats": Payload,
    "host.card": Payload,
    "host.unlock_audio": Payload,
    "host.adjust_chips": Payload,
    "host.set_backend_url": Payload,
}

# Every server message type. Kept as a flat tuple so scripts/check_protocol.py can diff it against protocol.ts.
SERVER_MESSAGES: tuple[str, ...] = (
    "session.welcome", "session.pong", "session.snapshot", "session.error",
    "motion.status", "motion.meter", "motion.gesture", "motion.calib",
    "seat.update",
    "match.start", "match.phase", "match.tick", "match.turn_result", "match.end", "match.pause",
    "agent.decision", "agent.studying",
    "market.window", "market.bet_ack", "market.odds", "market.settle", "market.leaderboard", "market.balance",
    "sponsor.warn", "sponsor.applied", "sponsor.ack", "crate.open", "crate.result", "card.vote_open", "card.vote_result",
    "pair.prompt", "pair.result",
    "voice.line", "sfx.play",
    "host.ack", "host.config", "host.diagnostics", "ladder.update",
)

# Types the per-connection send queue may drop first when a client is slow (high-rate, superseded by the next one).
DROPPABLE: frozenset[str] = frozenset({"motion.meter", "market.odds", "match.tick", "motion.status"})


class ClientMsg(BaseModel):
    t: str
    cseq: int = 0
    d: dict[str, Any] = Field(default_factory=dict)


class Envelope(BaseModel):
    t: str
    seq: int
    match: str | None = None
    ts: int
    d: dict[str, Any] = Field(default_factory=dict)

    def dumps(self) -> str:
        return json.dumps(self.model_dump(), separators=(",", ":"), default=_json_default)


def _json_default(o):
    if hasattr(o, "model_dump"):
        return o.model_dump()
    if hasattr(o, "__dict__"):
        return o.__dict__
    raise TypeError(f"not serializable: {type(o)}")


class ProtocolError(ValueError):
    pass


def parse_client(raw: str | bytes) -> ClientMsg:
    """Validate an inbound message: known type, payload shape. Raises ProtocolError."""
    try:
        obj = json.loads(raw)
    except (ValueError, TypeError) as e:
        raise ProtocolError(f"bad json: {e}") from e
    if not isinstance(obj, dict) or "t" not in obj:
        raise ProtocolError("missing t")
    t = obj["t"]
    model = CLIENT_MESSAGES.get(t)
    if model is None:
        raise ProtocolError(f"unknown type {t!r}")
    d = obj.get("d") or {}
    try:
        payload = model.model_validate(d)
    except ValidationError as e:
        raise ProtocolError(f"{t}: {e.errors()[0]['msg']} at {e.errors()[0]['loc']}") from e
    if t == "motion.frame":
        for s in payload.s:  # type: ignore[attr-defined]
            if len(s) != SAMPLE_LEN:
                raise ProtocolError(f"motion.frame sample must have {SAMPLE_LEN} numbers")
    return ClientMsg(t=t, cseq=int(obj.get("cseq", 0) or 0), d=payload.model_dump())
