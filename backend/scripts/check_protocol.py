"""Drift guard: every message type in protocol.py must appear in web/src/protocol.ts and vice versa."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.protocol import CLIENT_MESSAGES, SERVER_MESSAGES  # noqa: E402

ts = (Path(__file__).resolve().parents[2] / "web" / "src" / "protocol.ts").read_text()


def block(name: str) -> set[str]:
    m = re.search(rf"export const {name} = \[(.*?)\] as const", ts, re.S)
    assert m, f"{name} not found in protocol.ts"
    return set(re.findall(r"'([a-z_.]+)'", m.group(1)))


py_server, py_client = set(SERVER_MESSAGES), set(CLIENT_MESSAGES)
ts_server, ts_client = block("SERVER_MESSAGES"), block("CLIENT_MESSAGES")
problems = []
for label, a, b in (("server: only in py", py_server, ts_server), ("server: only in ts", ts_server, py_server),
                    ("client: only in py", py_client, ts_client), ("client: only in ts", ts_client, py_client)):
    if a - b:
        problems.append(f"{label}: {sorted(a - b)}")
if problems:
    print("\n".join(problems)); sys.exit(1)
print(f"protocol in sync: {len(py_server)} server types, {len(py_client)} client types")
