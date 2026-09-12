import glob
import os
from collections import Counter

import pytest

from app.config import Config
from app.motion import synth
from app.motion.synth import calibration_sequence, compose, rest, read_trace
from app.motion.worker import Pipeline

TRACES = os.path.join(os.path.dirname(__file__), "..", "..", "traces")


def cfg():
    return Config.load().section("motion")


def run(samples, sport):
    p = Pipeline(cfg(), "t", sport)
    out = []
    for s in samples:
        out.extend(p.feed_sample(s))
    assert p.calibrated, "calibration never completed"
    return out


def kinds(gs):
    return Counter(g.kind for g in gs)


@pytest.mark.parametrize("name", list(synth.catalog(60).keys()))
def test_catalog_expectations(name):
    samples, meta = synth.catalog(60)[name]
    gs = run(samples, meta["sport"])
    got = {k: v for k, v in kinds(gs).items() if k in meta["expect"] or k not in ("release",) or "release" in meta["expect"]}
    for k, n in meta["expect"].items():
        assert got.get(k, 0) == n, f"{name}: expected {n} {k}, got {dict(kinds(gs))}"
    if not meta["expect"]:
        assert not gs, f"{name}: expected silence, got {dict(kinds(gs))}"
    if "punch_type" in meta:
        assert [g.extra["type"] for g in gs if g.kind == "punch"] == [meta["punch_type"]]


@pytest.mark.parametrize("hz", [30, 60, 100])
@pytest.mark.parametrize("sigma", [0.1, 0.4])
def test_swing_across_rates_and_noise(hz, sigma):
    samples = compose(calibration_sequence(hz, "upright"), rest(hz, 0.5, sigma=sigma, pose="upright"),
                      synth.swing(hz, sigma=sigma, gamma_lane=15, spin_dps=-200), rest(hz, 0.5, sigma=sigma, pose="upright"))
    gs = run(samples, "bowling")
    assert kinds(gs) == {"swing": 1, "release": 1}, dict(kinds(gs))
    rel = [g for g in gs if g.kind == "release"][0]
    assert rel.extra["lane"] > 0.3 and rel.sign == -1 and rel.extra["spin"] < -0.3
    walk = compose(calibration_sequence(hz, "flat"), synth.walk(hz, 6))
    assert run(walk, "bowling") == []


def test_power_monotonic_in_peak():
    powers = []
    for peak in (14, 20, 28, 40):
        gs = run(compose(calibration_sequence(60, "upright"), synth.swing(60, peak=peak)), "baseball")
        powers.append([g for g in gs if g.kind == "swing"][0].power)
    assert powers == sorted(powers) and powers[0] < 0.2 and powers[-1] == 1.0


def test_cooldown_merges_close_swings():
    # peaks 480 ms apart: inside bowling's 600 ms cooldown (merged), outside baseball's 450 ms (two swings)
    close = compose(calibration_sequence(60, "upright"), synth.swing(60, tail_ms=0), synth.swing(60, lead_ms=0, seed=9), rest(60, 0.5, pose="upright"))
    apart = compose(calibration_sequence(60, "upright"), synth.swing(60), rest(60, 0.4, pose="upright"), synth.swing(60, seed=9), rest(60, 0.5, pose="upright"))
    assert kinds(run(close, "bowling"))["swing"] == 1
    assert kinds(run(close, "baseball"))["swing"] == 2
    assert kinds(run(apart, "bowling"))["swing"] == 2


def test_punch_types_and_cooldown():
    seq = compose(calibration_sequence(60, "upright"), synth.punch(60, "jab"), synth.punch(60, "hook", seed=2), synth.punch(60, "jab", seed=3), rest(60, 0.3, pose="upright", sigma=0.05))
    gs = [g for g in run(seq, "boxing") if g.kind == "punch"]
    assert [g.extra["type"] for g in gs] == ["jab", "hook", "jab"]
    assert all(g.power > 0.2 for g in gs)


def test_block_on_off_timing():
    seq = compose(calibration_sequence(60, "upright"), synth.unblock(60), rest(60, 0.4, pose="flat"), synth.block(60, 1.0), synth.unblock(60), rest(60, 0.3, pose="flat"))
    gs = run(seq, "boxing")
    names = [g.kind for g in gs if g.kind.startswith("block")]
    assert names == ["block_on", "block_off"]


def test_dodge_requires_no_forward_spike():
    assert kinds(run(compose(calibration_sequence(60, "upright"), synth.dodge(60)), "boxing"))["dodge"] == 1
    gs = run(compose(calibration_sequence(60, "upright"), synth.dodge(60, with_spike=True)), "boxing")
    assert kinds(gs)["dodge"] == 0


def test_bump_and_shake_and_flick_idle_set():
    assert kinds(run(compose(calibration_sequence(60, "flat"), synth.bump(60)), "idle"))["bump"] == 1
    assert kinds(run(compose(calibration_sequence(60, "flat"), synth.shake(60)), "idle"))["shake"] == 1
    assert kinds(run(compose(calibration_sequence(60, "flat"), synth.flick(60)), "idle"))["flick"] == 1


def test_committed_traces_match_headers():
    files = sorted(glob.glob(os.path.join(TRACES, "synth", "*.jsonl")))
    assert files, "run scripts/gen_synth_traces.py"
    real = sorted(glob.glob(os.path.join(TRACES, "real", "*.jsonl")))
    for path in files + real:
        header, frames = read_trace(path)
        p = Pipeline(cfg(), "trace", header.get("sport", "all"))
        gs = []
        for fr in frames:
            gs.extend(p.feed_frame(fr))
        got = kinds(gs)
        for k, n in header.get("expect", {}).items():
            assert got.get(k, 0) == n, f"{os.path.basename(path)}: {dict(got)}"
        if not header.get("expect"):
            assert not gs, f"{os.path.basename(path)}: {dict(got)}"
