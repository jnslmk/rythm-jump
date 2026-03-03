from rhythm_jump.engine.scoring import judge


def test_judge_returns_perfect_within_perfect_window() -> None:
    assert judge(delta_ms=10, perfect=30, good=70) == 'perfect'


def test_judge_returns_good_outside_perfect_within_good_window() -> None:
    assert judge(delta_ms=50, perfect=30, good=70) == 'good'


def test_judge_returns_miss_outside_good_window() -> None:
    assert judge(delta_ms=120, perfect=30, good=70) == 'miss'


def test_judge_uses_absolute_delta_for_negative_values() -> None:
    assert judge(delta_ms=-25, perfect=30, good=70) == 'perfect'
