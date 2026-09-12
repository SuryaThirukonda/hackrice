"""Run calibration + detectors over a JSONL trace and print gestures. --live streams it over the WebSocket instead (M3)."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import Config  # noqa: E402
from app.motion.synth import read_trace  # noqa: E402
from app.motion.worker import Pipeline  # noqa: E402


def replay(path: str, sport: str | None = None, verbose: bool = True) -> list:
    header, frames = read_trace(path)
    cfg = Config.load().section("motion")
    p = Pipeline(cfg, "replay", sport or header.get("sport", "all"))
    gestures = []
    for fr in frames:
        gestures.extend(p.feed_frame(fr))
    if verbose:
        print(f"{Path(path).name}: {header.get('label')} sport={p.sport} hz={p.hz:.1f} calib={p.calibrator.calib.public()}")
        for g in gestures:
            print(f"  {g.kind:10s} t={g.t_phone:8.0f} power={g.power:.2f} axis={g.axis}{'+' if g.sign > 0 else '-'} dur={g.duration_ms:.0f}ms {g.extra}")
        if not gestures:
            print("  (no gestures)")
    return gestures


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("trace", nargs="+")
    ap.add_argument("--sport")
    a = ap.parse_args()
    for t in a.trace:
        replay(t, a.sport)
