from tests.conftest import run_for


def token_of(arena, seat_id):
    return arena.state.seats[seat_id].token


def test_claim_rotates_token_and_second_scan_is_taken(arena, make_client):
    proj = make_client("projector")
    tok = token_of(arena, "P1")
    r1 = make_client("remote", token=tok, nickname="Ace")
    w = r1.last("session.welcome").d
    assert w["seat_id"] == "P1" and w["seat_token"] != tok and w["reason"] is None
    seats = proj.last("seat.update").d["seats"]
    assert seats[0]["status"] == "claimed" and seats[0]["join_url"] is None and seats[0]["nickname"] == "Ace"
    r2 = make_client("remote", token=tok)
    assert r2.last("session.welcome").d["seat_id"] is None and r2.last("session.welcome").d["reason"] == "taken"


def test_reconnect_with_private_token_resumes_seat(arena, make_client):
    r1 = make_client("remote", token=token_of(arena, "P1"))
    private = r1.last("session.welcome").d["seat_token"]
    r1.disconnect()
    r1b = make_client("remote", device_id=r1.device_id, token=private)
    assert r1b.last("session.welcome").d["seat_id"] == "P1"


def test_same_device_with_stale_qr_token_resumes_seat(arena, make_client):
    tok = token_of(arena, "P1")
    r1 = make_client("remote", token=tok)
    r1.disconnect()
    again = make_client("remote", device_id=r1.device_id, token=tok)   # page refresh keeps the old URL
    assert again.last("session.welcome").d["seat_id"] == "P1"
    other = make_client("remote", token=tok)                             # a different phone with the old QR is refused
    assert other.last("session.welcome").d["reason"] == "taken"


def test_release_regenerates_token_and_url(arena, make_client, clock):
    proj = make_client("projector")
    old = token_of(arena, "P1")
    r1 = make_client("remote", token=old)
    arena.rooms.release_seat("P1")
    arena.step()
    s = arena.state.seats["P1"]
    assert s.status == "open" and s.token not in (old, r1.last("session.welcome").d["seat_token"])
    assert proj.last("seat.update").d["seats"][0]["join_url"].endswith(s.token)
    assert arena.state.devices[r1.device_id].seat_id is None


def test_unclaimed_seat_auto_releases_after_timeout(arena, make_client, clock):
    r1 = make_client("remote", token=token_of(arena, "P1"))
    assert arena.state.seats["P1"].status == "claimed"
    run_for(arena, clock, 21, dt=0.5)   # never calibrated, never sent frames
    assert arena.state.seats["P1"].status == "open"


def test_snapshot_role_scoping(arena, make_client):
    make_client("remote", token=token_of(arena, "P1"))
    rail = make_client("rail", nickname="Bettor")
    host = make_client("host")
    rs = rail.last("session.snapshot").d; hs = host.last("session.snapshot").d
    assert "seat_tokens" not in rs and "devices" not in rs and rs["me"]["nickname"] == "Bettor"
    assert "seat_tokens" in hs and any(d["role"] == "remote" for d in hs["devices"])


def test_resync_yields_snapshot_and_ping_estimates_offset(arena, make_client, clock):
    rail = make_client("rail")
    rail.send("session.resync", {"last_seq": 0}); arena.step()
    assert rail.last("session.snapshot") is not None
    for i in range(5):
        rail.send("session.ping", {"t_client": clock.now_ms() - 1000, "rtt_ms": 40}); arena.step()
    assert rail.last("session.pong").d["t_client"] == clock.now_ms() - 1000
    assert abs(arena.rooms.offset_ms(rail.device_id) - 980) < 1


def test_set_public_url_rewrites_join_urls(arena, make_client):
    host = make_client("host")
    host.send("host.set_public_url", {"url": "https://demo.trycloudflare.com/"}); arena.step()
    assert host.last("seat.update").d["seats"][0]["join_url"].startswith("https://demo.trycloudflare.com/remote?seat=P1&tok=")
    assert host.last("seat.update").d["rail_url"] == "https://demo.trycloudflare.com/rail"
