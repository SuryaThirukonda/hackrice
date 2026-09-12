from app.store.db import Store


def test_rows_land_after_flush(tmp_path):
    s = Store(tmp_path / "t.db", batch_ms=20)
    s.write("ledger", {"device_id": "d1", "delta": 500, "reason": "join_grant", "ref_id": None, "ts": 1.0})
    s.write("ledger", {"device_id": "d1", "delta": -25, "reason": "bet_place", "ref_id": "m1", "ts": 2.0})
    s.write("matches", {"match_id": "m_1", "sport": "bowling", "seed": 7, "opponent_tier": "rookie", "scenario": None, "started_ts": 1.0, "ended_ts": None, "winner": None})
    s.write("matches", {"match_id": "m_1", "sport": "bowling", "seed": 7, "opponent_tier": "rookie", "scenario": None, "started_ts": 1.0, "ended_ts": 9.0, "winner": "human"})
    s.flush()
    assert s.query("select sum(delta) from ledger")[0][0] == 475
    assert s.query("select winner from matches")[0][0] == "human"
    s.close()
