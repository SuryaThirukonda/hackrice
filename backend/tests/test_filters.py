from app.motion.filters import Preprocessor, parse_wire


def test_parse_and_forward_component():
    p = Preprocessor(alpha=1.0)
    p.forward_axis, p.forward_sign = 1, -1.0
    s = p.process([0, 1.0, 2.0, 3.0, 1.0, 2.0, 12.81, 10, 20, 30, 0, 90, 5])
    assert s.a_mag > 3.7 and s.a_fwd == -2.0 and s.w_long == 20 and s.tilt_from_vertical == 0
    assert parse_wire([0] * 13)[0] == 0


def test_ema_smooths_and_rate_scaling():
    p = Preprocessor(alpha=0.5, nominal_hz=60)
    p.process([0, 0, 0, 0, 0, 0, 9.81, 0, 0, 0, 0, 0, 0])
    s = p.process([16, 0, 10, 0, 0, 10, 9.81, 0, 0, 0, 0, 0, 0])
    assert 4.9 < s.a[1] < 5.1
    p.set_rate(120)
    assert p.alpha < 0.5


def test_gravity_fallback_when_linear_missing():
    p = Preprocessor(alpha=1.0)
    p.gravity, p.use_fallback = [0, 0, 9.81], True
    s = p.process([0, 0, 0, 0, 0, 5.0, 9.81, 0, 0, 0, 0, 0, 0])
    assert abs(s.a[1] - 5.0) < 1e-9
