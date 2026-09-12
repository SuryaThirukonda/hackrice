from app.arena import ArenaLoop, Connection, Intent, SendQueue
from app.clock import FakeClock
from app.config import Config
from app.protocol import DROPPABLE


def make_loop():
    return ArenaLoop(Config.load(), clock=FakeClock())


def test_seq_is_global_and_monotonic():
    loop = make_loop()
    a = Connection("a", "rail", "d1", SendQueue()); b = Connection("b", "projector", "d2", SendQueue())
    loop.add_connection(a); loop.add_connection(b)
    loop.emit("x.one", to="rail"); loop.emit("x.two", to="projector"); loop.emit("x.three", to="all")
    out = loop.flush_events()
    assert [e.seq for e in out] == [1, 2, 3]
    assert [e.t for e in a.out.drain()] == ["x.one", "x.three"]
    assert [e.t for e in b.out.drain()] == ["x.two", "x.three"]


def test_intents_handled_in_order():
    loop = make_loop()
    seen = []
    loop.on("a", lambda i: seen.append(i.d["n"]))
    for n in range(5):
        loop.submit(Intent("a", {"n": n}))
    loop.step()
    assert seen == [0, 1, 2, 3, 4]


def test_device_and_conn_addressing():
    loop = make_loop()
    a = Connection("a", "rail", "dev1", SendQueue()); b = Connection("b", "rail", "dev1", SendQueue()); c = Connection("c", "rail", "dev2", SendQueue())
    for x in (a, b, c):
        loop.add_connection(x)
    loop.emit("m", to=("device", "dev1")); loop.emit("n", to=("conn", "c")); loop.flush_events()
    assert [e.t for e in a.out.drain()] == ["m"] and [e.t for e in b.out.drain()] == ["m"] and [e.t for e in c.out.drain()] == ["n"]


def test_slow_consumer_drops_droppable_first():
    q = SendQueue(maxlen=4)
    from app.protocol import Envelope
    for i in range(4):
        q.push(Envelope(t="motion.meter" if i % 2 else "match.start", seq=i, ts=0))
    q.push(Envelope(t="market.settle", seq=9, ts=0))       # must evict a droppable, not the important ones
    types = [e.t for e in q.drain()]
    assert "market.settle" in types and "match.start" in types and types.count("motion.meter") == 1 and q.dropped == 1
    q.push(Envelope(t="a", seq=1, ts=0)); q.push(Envelope(t="b", seq=2, ts=0)); q.push(Envelope(t="c", seq=3, ts=0)); q.push(Envelope(t="d", seq=4, ts=0))
    q.push(Envelope(t="motion.meter", seq=5, ts=0))         # droppable arriving on a full queue is dropped itself
    assert [e.t for e in q.drain()] == ["a", "b", "c", "d"]
    assert "match.tick" in DROPPABLE


def test_timers_fake_clock():
    clock = FakeClock(); loop = ArenaLoop(Config.load(), clock=clock)
    fired = []
    loop.schedule_every(0.05, lambda: fired.append(clock.now()), key="tick")
    loop.schedule_in(1.0, lambda: fired.append("once"), key="once")
    for _ in range(60):
        clock.advance(0.05); loop.step()
    assert fired.count("once") == 1 and len(fired) == 61
    loop.cancel("tick"); clock.advance(1); loop.step()
    assert len(fired) == 61


def test_timer_replace_and_cancel():
    clock = FakeClock(); loop = ArenaLoop(Config.load(), clock=clock)
    hits = []
    loop.schedule_in(1.0, lambda: hits.append("first"), key="k")
    loop.schedule_in(2.0, lambda: hits.append("second"), key="k")  # replaces
    clock.advance(1.5); loop.step(); assert hits == []
    clock.advance(1.0); loop.step(); assert hits == ["second"]
    assert not loop.has_timer("k")
