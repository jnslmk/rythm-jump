import pytest

from rythm_jump.engine.led_frames import InputPulse, build_led_frame, project_bar
from rythm_jump.engine.types import LaneInputEvent

STRIP_LEN = 120
HALF_STRIP_LEN = STRIP_LEN // 2
MAX_LED_INDEX = STRIP_LEN - 1
CENTER_LEFT_INDEX = HALF_STRIP_LEN - 1
CENTER_RIGHT_INDEX = HALF_STRIP_LEN
LEFT_BAR_START_INDEX = HALF_STRIP_LEN - 4
RIGHT_BAR_END_INDEX = HALF_STRIP_LEN + 3
TOO_SHORT_STRIP_LENS = [0, 1]
ODD_STRIP_LEN = 119

TYPE_ERROR_MSG = "strip_len must be an int"
SIDE_ERROR_MSG = "side must be 'left' or 'right'"
MIN_LEN_ERROR_MSG = "strip_len must be >= 2"
EVEN_LEN_ERROR_MSG = "strip_len must be even"
FINITE_PROGRESS_ERROR_MSG = "progress must be finite"


def test_left_progress_full_maps_to_start_of_strip() -> None:
    assert project_bar(strip_len=STRIP_LEN, progress=1.0, side="left") == 0


def test_right_progress_full_maps_to_end_of_strip() -> None:
    assert project_bar(strip_len=STRIP_LEN, progress=1.0, side="right") == MAX_LED_INDEX


def test_progress_zero_maps_to_center_adjacent_origins() -> None:
    assert (
        project_bar(strip_len=STRIP_LEN, progress=0.0, side="left")
        == LEFT_BAR_START_INDEX
    )
    assert (
        project_bar(strip_len=STRIP_LEN, progress=0.0, side="right")
        == RIGHT_BAR_END_INDEX
    )


def test_progress_is_clipped_to_range_zero_to_one() -> None:
    assert (
        project_bar(strip_len=STRIP_LEN, progress=-1.0, side="left")
        == LEFT_BAR_START_INDEX
    )
    assert project_bar(strip_len=STRIP_LEN, progress=2.0, side="right") == MAX_LED_INDEX


def test_invalid_side_raises_value_error() -> None:
    with pytest.raises(ValueError, match=SIDE_ERROR_MSG):
        project_bar(strip_len=STRIP_LEN, progress=0.5, side="center")  # type: ignore[arg-type]


@pytest.mark.parametrize("strip_len", TOO_SHORT_STRIP_LENS)
def test_strip_len_less_than_two_raises_value_error(strip_len: int) -> None:
    with pytest.raises(ValueError, match=MIN_LEN_ERROR_MSG):
        project_bar(strip_len=strip_len, progress=0.5, side="left")


def test_odd_strip_len_raises_value_error() -> None:
    with pytest.raises(ValueError, match=EVEN_LEN_ERROR_MSG):
        project_bar(strip_len=ODD_STRIP_LEN, progress=0.5, side="right")


def test_nan_progress_raises_value_error() -> None:
    with pytest.raises(ValueError, match=FINITE_PROGRESS_ERROR_MSG):
        project_bar(strip_len=STRIP_LEN, progress=float("nan"), side="left")


@pytest.mark.parametrize("progress", [float("inf"), float("-inf")])
def test_infinite_progress_raises_value_error(progress: float) -> None:
    with pytest.raises(ValueError, match=FINITE_PROGRESS_ERROR_MSG):
        project_bar(strip_len=STRIP_LEN, progress=progress, side="right")


def test_non_int_strip_len_raises_type_error() -> None:
    with pytest.raises(TypeError, match=TYPE_ERROR_MSG):
        project_bar(strip_len=float(STRIP_LEN), progress=0.5, side="left")  # type: ignore[arg-type]


def test_build_led_frame_projects_note_bars_across_strip() -> None:
    frame = build_led_frame(
        strip_len=STRIP_LEN,
        travel_time_ms=1000,
        progress_ms=500,
        left_hit_times=[1000],
        right_hit_times=[1000],
        input_events=[],
        input_pulses=[],
    )

    lit_indexes = [index for index, pixel in enumerate(frame.pixels) if any(pixel)]
    assert min(lit_indexes) < CENTER_LEFT_INDEX
    assert max(lit_indexes) > CENTER_RIGHT_INDEX


def test_build_led_frame_keeps_left_bar_off_outer_edge_before_hit() -> None:
    frame = build_led_frame(
        strip_len=STRIP_LEN,
        travel_time_ms=1000,
        progress_ms=900,
        left_hit_times=[1000],
        right_hit_times=[],
        input_events=[],
        input_pulses=[],
    )

    assert not any(any(pixel) for pixel in frame.pixels[:3])


def test_build_led_frame_touches_outer_edge_just_before_hit() -> None:
    frame = build_led_frame(
        strip_len=STRIP_LEN,
        travel_time_ms=1000,
        progress_ms=999,
        left_hit_times=[1000],
        right_hit_times=[],
        input_events=[],
        input_pulses=[],
    )

    assert any(frame.pixels[0])


def test_build_led_frame_hides_note_bar_once_hit_time_is_reached() -> None:
    frame = build_led_frame(
        strip_len=STRIP_LEN,
        travel_time_ms=1000,
        progress_ms=1000,
        left_hit_times=[1000],
        right_hit_times=[1000],
        input_events=[],
        input_pulses=[],
    )

    assert not any(any(pixel) for pixel in frame.pixels)


def test_build_led_frame_overlays_input_pulses_near_center() -> None:
    frame = build_led_frame(
        strip_len=STRIP_LEN,
        travel_time_ms=1000,
        progress_ms=200,
        left_hit_times=[],
        right_hit_times=[],
        input_events=[LaneInputEvent(lane="left", source="web", progress_ms=200)],
        input_pulses=[InputPulse(lane="left", started_ms=150)],
    )

    assert frame.levels[0] > 0
    center_pixels = frame.pixels[CENTER_LEFT_INDEX - 2 : CENTER_LEFT_INDEX + 1]
    assert any(any(pixel) for pixel in center_pixels)
