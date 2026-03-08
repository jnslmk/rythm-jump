import pytest

from rythm_jump.engine.led_frames import project_bar

STRIP_LEN = 120
HALF_STRIP_LEN = STRIP_LEN // 2
MAX_LED_INDEX = STRIP_LEN - 1
CENTER_LEFT_INDEX = HALF_STRIP_LEN - 1
CENTER_RIGHT_INDEX = HALF_STRIP_LEN
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
        project_bar(strip_len=STRIP_LEN, progress=0.0, side="left") == CENTER_LEFT_INDEX
    )
    assert (
        project_bar(strip_len=STRIP_LEN, progress=0.0, side="right")
        == CENTER_RIGHT_INDEX
    )


def test_progress_is_clipped_to_range_zero_to_one() -> None:
    assert (
        project_bar(strip_len=STRIP_LEN, progress=-1.0, side="left")
        == CENTER_LEFT_INDEX
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
