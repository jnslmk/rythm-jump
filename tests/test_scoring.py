import pytest

from rythm_jump.engine.scoring import judge


def test_judge_returns_perfect_within_perfect_window() -> None:
    assert judge(delta_ms=10, perfect=30, good=70) == "perfect"


def test_judge_returns_good_outside_perfect_within_good_window() -> None:
    assert judge(delta_ms=50, perfect=30, good=70) == "good"


def test_judge_returns_miss_outside_good_window() -> None:
    assert judge(delta_ms=120, perfect=30, good=70) == "miss"


def test_judge_uses_absolute_delta_for_negative_values() -> None:
    assert judge(delta_ms=-25, perfect=30, good=70) == "perfect"


def test_judge_boundary_at_perfect_is_perfect() -> None:
    assert judge(delta_ms=30, perfect=30, good=70) == "perfect"


def test_judge_boundary_at_good_is_good() -> None:
    assert judge(delta_ms=70, perfect=30, good=70) == "good"


@pytest.mark.parametrize(
    ("perfect", "good"),
    [
        (-1, 70),
        (30, -1),
        (71, 70),
    ],
)
def test_judge_rejects_invalid_windows(perfect: int, good: int) -> None:
    with pytest.raises(ValueError):
        judge(delta_ms=10, perfect=perfect, good=good)
