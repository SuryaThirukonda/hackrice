"""Write the synthetic trace catalog to traces/synth/*.jsonl (committed; the detector test reads them)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.motion.synth import catalog, write_trace  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "traces" / "synth"

if __name__ == "__main__":
    for hz in (60,):
        for name, (samples, meta) in catalog(hz).items():
            header = {"source": "synthetic", "hz": hz, "label": name, "device": "synth", **meta}
            write_trace(OUT / f"{name}_{hz}hz.jsonl", samples, header)
            print(f"wrote {name}_{hz}hz.jsonl ({len(samples)} samples)")
