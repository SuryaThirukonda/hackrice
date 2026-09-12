"""SQLite store: one writer thread, batched inserts every 250 ms. Reads for the UI come from in-memory state."""
from __future__ import annotations

import json
import os
import queue
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

SCHEMA = Path(__file__).with_name("schema.sql").read_text()
UPSERT_TABLES = {"devices", "matches", "markets", "bets"}
# Tables whose rows are written more than once with partial data (matches: start row, then end row). Merge instead of
# replacing so a NULL in the later row never erases what the earlier one stored (started_ts, scenario).
MERGE_TABLES = {"matches": "match_id"}


class Store:
    def __init__(self, path: str | Path = "hap.db", batch_ms: int = 250):
        # HAP_DB overrides the SQLite path (rehearsal.sh uses it to keep its run out of the shared hap.db).
        self.path = os.environ.get("HAP_DB") or str(path)
        self.batch_s = batch_ms / 1000
        self.q: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()
        self._flushed = threading.Event()
        self._thread = threading.Thread(target=self._run, name="hap-store", daemon=True)
        self.written = 0
        self._init()
        self._thread.start()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, check_same_thread=False)
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _init(self) -> None:
        conn = self._connect()
        conn.executescript(SCHEMA)
        conn.commit()
        conn.close()

    def write(self, table: str, row: dict[str, Any]) -> None:
        self.q.put((table, row))

    def _run(self) -> None:
        conn = self._connect()
        while True:
            item = self.q.get()
            if item is None:
                break
            batch = [item]
            deadline = time.monotonic() + self.batch_s
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    nxt = self.q.get(timeout=remaining)
                except queue.Empty:
                    break
                if nxt is None:
                    self._commit(conn, batch)
                    conn.close()
                    self._flushed.set()
                    return
                batch.append(nxt)
            self._commit(conn, batch)
            if self.q.empty():
                self._flushed.set()
        conn.close()
        self._flushed.set()

    def _commit(self, conn: sqlite3.Connection, batch: list[tuple[str, dict[str, Any]]]) -> None:
        by_table: dict[str, list[dict[str, Any]]] = {}
        for table, row in batch:
            by_table.setdefault(table, []).append(row)
        try:
            for table, rows in by_table.items():
                cols = list(rows[0].keys())
                verb = "INSERT OR REPLACE" if table in UPSERT_TABLES else "INSERT"
                if table == "__noop__":
                    continue
                sql = f"{verb} INTO {table}({','.join(cols)}) VALUES({','.join('?' * len(cols))})"
                if table in MERGE_TABLES:
                    key = MERGE_TABLES[table]
                    sets = ", ".join(f"{c}=COALESCE(excluded.{c}, {table}.{c})" for c in cols if c != key)
                    sql = f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join('?' * len(cols))}) ON CONFLICT({key}) DO UPDATE SET {sets}"
                conn.executemany(sql, [tuple(_coerce(r.get(c)) for c in cols) for r in rows])
            conn.commit()
            self.written += len(batch)
        except sqlite3.Error as e:  # never let a persistence bug kill the writer
            print(f"[store] write failed: {e}")
            conn.rollback()

    def flush(self, timeout: float = 2.0) -> None:
        """Block until the queue has been committed (tests and shutdown)."""
        self._flushed.clear()
        if self.q.empty():
            self.q.put(("__noop__", {}))  # wake the writer so it commits and sets the event
        self._flushed.wait(timeout)

    def close(self) -> None:
        self.q.put(None)
        self._thread.join(timeout=3)

    def query(self, sql: str, params: tuple = ()) -> list[tuple]:
        conn = self._connect()
        try:
            return conn.execute(sql, params).fetchall()
        finally:
            conn.close()


def _coerce(v: Any) -> Any:
    if isinstance(v, (dict, list, tuple)):
        return json.dumps(v, separators=(",", ":"))
    if isinstance(v, bool):
        return int(v)
    return v
