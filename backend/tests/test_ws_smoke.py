import json

from fastapi.testclient import TestClient

from app.main import app


def recv_until(ws, t, limit=20, where=None):
    for _ in range(limit):
        m = json.loads(ws.receive_text())
        if m["t"] == t and (where is None or where(m)):
            return m
    raise AssertionError(f"no {t}")


def test_hello_flows_over_real_socket():
    with TestClient(app) as c:
        with c.websocket_connect("/ws?role=projector&device=proj1") as proj:
            proj.send_text(json.dumps({"t": "session.hello", "d": {"role": "projector", "device_id": "proj1"}}))
            w = recv_until(proj, "session.welcome"); assert w["d"]["role"] == "projector"
            snap = recv_until(proj, "session.snapshot"); seat = snap["d"]["seats"][0]
            tok = seat["join_url"].split("tok=")[1]
            with c.websocket_connect("/ws?role=remote&device=phone1") as rem:
                rem.send_text(json.dumps({"t": "session.hello", "d": {"role": "remote", "device_id": "phone1", "token": tok, "nickname": "Judge"}}))
                w2 = recv_until(rem, "session.welcome"); assert w2["d"]["seat_id"] == "P1"
                upd = recv_until(proj, "seat.update", where=lambda m: m["d"]["seats"][0]["status"] == "claimed")
                rem.send_text("garbage"); err = recv_until(rem, "session.error"); assert "json" in err["d"]["reason"]
            upd = recv_until(proj, "motion.status")  # disconnect notice reaches projector
            assert upd["d"]["connected"] is False
        r = c.get("/api/seats"); assert r.json()["seats"][0]["seat_id"] == "P1"
