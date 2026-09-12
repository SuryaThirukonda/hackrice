import pytest

from scripts.headless_sim import simulate

BANDS = {"rookie": (0.55, 0.9), "contender": (0.4, 0.75), "champion": (0.2, 0.5), "boss": (0.05, 0.35)}


@pytest.mark.slow
@pytest.mark.parametrize("sport", ["bowling", "boxing", "baseball"])
def test_human_win_rate_bands(sport):
    for tier, (lo, hi) in BANDS.items():
        r = simulate(sport, tier, 40, seed=3)
        assert lo <= r["human_win_rate"] <= hi, f"{sport}/{tier}: {r}"
