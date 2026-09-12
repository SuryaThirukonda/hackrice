import json
import pytest

from app.protocol import CLIENT_MESSAGES, SAMPLE_LEN, Envelope, ProtocolError, parse_client


def test_hello_roundtrip():
    m = parse_client(json.dumps({"t": "session.hello", "cseq": 3, "d": {"role": "remote", "device_id": "abcd1234", "token": "x"}}))
    assert m.t == "session.hello" and m.cseq == 3 and m.d["role"] == "remote"


@pytest.mark.parametrize("raw", ["not json", "[]", '{"d": {}}', '{"t": "nope.nothing", "d": {}}',
                                 '{"t": "session.hello", "d": {"role": "admin", "device_id": "abcd"}}',
                                 '{"t": "market.bet", "d": {"market_id": "m", "outcome_id": "o", "stake": 0}}'])
def test_rejects_bad_messages(raw):
    with pytest.raises(ProtocolError):
        parse_client(raw)


def test_motion_frame_sample_length():
    good = {"t": "motion.frame", "d": {"t0": 1.0, "n": 1, "s": [[0.0] * SAMPLE_LEN]}}
    assert parse_client(json.dumps(good)).d["n"] == 1
    bad = {"t": "motion.frame", "d": {"t0": 1.0, "n": 1, "s": [[0.0] * 5]}}
    with pytest.raises(ProtocolError):
        parse_client(json.dumps(bad))


def test_every_client_type_has_a_model():
    for t, model in CLIENT_MESSAGES.items():
        assert "." in t and model is not None


def test_envelope_dumps_compact():
    e = Envelope(t="x.y", seq=1, match=None, ts=5, d={"a": 1})
    assert json.loads(e.dumps()) == {"t": "x.y", "seq": 1, "match": None, "ts": 5, "d": {"a": 1}}
