import pytest

from rhythm_jump.engine.led_frames import project_bar


def test_left_progress_full_maps_to_start_of_strip() -> None:
    assert project_bar(strip_len=120, progress=1.0, side='left') == 0


def test_right_progress_full_maps_to_end_of_strip() -> None:
    assert project_bar(strip_len=120, progress=1.0, side='right') == 119


def test_progress_zero_maps_to_center_adjacent_origins() -> None:
    assert project_bar(strip_len=120, progress=0.0, side='left') == 59
    assert project_bar(strip_len=120, progress=0.0, side='right') == 60


def test_progress_is_clipped_to_range_zero_to_one() -> None:
    assert project_bar(strip_len=120, progress=-1.0, side='left') == 59
    assert project_bar(strip_len=120, progress=2.0, side='right') == 119


def test_invalid_side_raises_value_error() -> None:
    with pytest.raises(ValueError):
        project_bar(strip_len=120, progress=0.5, side='center')  # type: ignore[arg-type]


@pytest.mark.parametrize('strip_len', [0, 1])
def test_strip_len_less_than_two_raises_value_error(strip_len: int) -> None:
    with pytest.raises(ValueError):
        project_bar(strip_len=strip_len, progress=0.5, side='left')


def test_odd_strip_len_raises_value_error() -> None:
    with pytest.raises(ValueError):
        project_bar(strip_len=119, progress=0.5, side='right')


def test_nan_progress_raises_value_error() -> None:
    with pytest.raises(ValueError):
        project_bar(strip_len=120, progress=float('nan'), side='left')


@pytest.mark.parametrize('progress', [float('inf'), float('-inf')])
def test_infinite_progress_raises_value_error(progress: float) -> None:
    with pytest.raises(ValueError):
        project_bar(strip_len=120, progress=progress, side='right')


def test_non_int_strip_len_raises_type_error() -> None:
    with pytest.raises(TypeError):
        project_bar(strip_len=120.0, progress=0.5, side='left')  # type: ignore[arg-type]
