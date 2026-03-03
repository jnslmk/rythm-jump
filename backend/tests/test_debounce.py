from rhythm_jump.hw.gpio_input import debounce_accept


def test_debounce_rejects_within_threshold() -> None:
    assert debounce_accept(last_ms=1000, now_ms=1010, threshold_ms=30) is False


def test_debounce_accepts_after_threshold() -> None:
    assert debounce_accept(last_ms=1000, now_ms=1040, threshold_ms=30) is True


def test_debounce_accepts_at_threshold_boundary() -> None:
    assert debounce_accept(last_ms=1000, now_ms=1030, threshold_ms=30) is True
