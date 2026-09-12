from app.config import Config
from app.motion.calib import Calibrator
from app.motion.synth import calibration_sequence, compose, rest, raise_phone


def cfg():
    return Config.load().section("motion")["calib"]


def test_rest_sets_threshold_and_gravity():
    c = Calibrator(cfg())
    for s in rest(60, 2.2, sigma=0.15, pose="upright"):
        c.feed(s)
    assert c.phase == "raise"
    cal = c.calib
    assert abs(cal.gravity[1] - 9.81) < 0.2 and cal.a_thr == 12.0 and 0.05 < cal.a_rest_sigma < 0.4


def test_noisy_phone_raises_threshold():
    c = Calibrator(cfg())
    for s in rest(60, 2.2, sigma=2.5, pose="flat"):
        c.feed(s)
    assert c.calib.a_thr > 12.0 and c.calib.a_thr == max(12.0, c.calib.a_rest_mean + 8 * c.calib.a_rest_sigma)


def test_raise_picks_forward_axis_and_rate():
    c = Calibrator(cfg())
    for s in calibration_sequence(60, "flat"):
        c.feed(s)
    assert c.phase == "done" and c.calib.done and c.calib.forward_axis == 1 and c.calib.forward_sign == 1.0
    assert 58 < c.calib.hz < 62 and c.rate_changed(30) and not c.rate_changed(62)


def test_fallback_detected_when_linear_is_all_zero():
    c = Calibrator(cfg())
    seq = compose(rest(60, 2.2), raise_phone(60, 1.1))
    for s in seq:
        s[1] = s[2] = s[3] = 0.0
        c.feed(s)
    assert c.calib.use_fallback and c.calib.forward_axis == 1
