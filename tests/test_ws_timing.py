from rythm_jump.api.ws import (
    DECAY_FACTOR,
    _decay_multiplier_for_delta_ms,
    _progress_ms_for_elapsed_s,
)

_DURATION_MS = 1200
_EXPECTED_PROGRESS_MS = 433


def test_progress_uses_elapsed_time_and_clamps_to_duration() -> None:
    assert _progress_ms_for_elapsed_s(10.0, 10.0, 0.0, _DURATION_MS) == 0
    assert (
        _progress_ms_for_elapsed_s(10.0, 10.533, 0.1, _DURATION_MS)
        == _EXPECTED_PROGRESS_MS
    )
    assert _progress_ms_for_elapsed_s(10.0, 12.5, 0.0, _DURATION_MS) == _DURATION_MS


def test_decay_multiplier_matches_legacy_100ms_behavior() -> None:
    assert _decay_multiplier_for_delta_ms(0) == 1.0
    assert _decay_multiplier_for_delta_ms(100) == DECAY_FACTOR


def test_decay_multiplier_scales_with_partial_tick_lengths() -> None:
    assert DECAY_FACTOR < _decay_multiplier_for_delta_ms(50) < 1.0
    assert _decay_multiplier_for_delta_ms(200) < DECAY_FACTOR
