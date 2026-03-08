import pytest

from rythm_jump.hw.gpio_input import debounce_accept

BASE_TIMESTAMP_MS = 1000
DEFAULT_THRESHOLD_MS = 30
ZERO_THRESHOLD_MS = 0
NEGATIVE_THRESHOLD_MS = -1
SMALL_OFFSET_MS = 10
LARGE_OFFSET_MS = 40
BACKWARD_OFFSET_MS = -10
THRESHOLD_ERROR_MSG = "threshold_ms must be >= 0"


def test_debounce_rejects_within_threshold() -> None:
    assert (
        debounce_accept(
            last_ms=BASE_TIMESTAMP_MS,
            now_ms=BASE_TIMESTAMP_MS + SMALL_OFFSET_MS,
            threshold_ms=DEFAULT_THRESHOLD_MS,
        )
        is False
    )


def test_debounce_accepts_after_threshold() -> None:
    assert (
        debounce_accept(
            last_ms=BASE_TIMESTAMP_MS,
            now_ms=BASE_TIMESTAMP_MS + LARGE_OFFSET_MS,
            threshold_ms=DEFAULT_THRESHOLD_MS,
        )
        is True
    )


def test_debounce_accepts_at_threshold_boundary() -> None:
    assert (
        debounce_accept(
            last_ms=BASE_TIMESTAMP_MS,
            now_ms=BASE_TIMESTAMP_MS + DEFAULT_THRESHOLD_MS,
            threshold_ms=DEFAULT_THRESHOLD_MS,
        )
        is True
    )


def test_debounce_rejects_non_monotonic_timestamps() -> None:
    assert (
        debounce_accept(
            last_ms=BASE_TIMESTAMP_MS,
            now_ms=BASE_TIMESTAMP_MS + BACKWARD_OFFSET_MS,
            threshold_ms=DEFAULT_THRESHOLD_MS,
        )
        is False
    )


def test_debounce_threshold_zero_accepts_equal_timestamp() -> None:
    assert (
        debounce_accept(
            last_ms=BASE_TIMESTAMP_MS,
            now_ms=BASE_TIMESTAMP_MS,
            threshold_ms=ZERO_THRESHOLD_MS,
        )
        is True
    )


def test_debounce_rejects_negative_threshold() -> None:
    with pytest.raises(ValueError, match=THRESHOLD_ERROR_MSG):
        debounce_accept(
            last_ms=BASE_TIMESTAMP_MS,
            now_ms=BASE_TIMESTAMP_MS + SMALL_OFFSET_MS,
            threshold_ms=NEGATIVE_THRESHOLD_MS,
        )
