import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from rythm_jump.engine.chart_loader import load_chart


TEST_SONG_ID = "sample-song"


def _base_chart_payload(song_id: str = TEST_SONG_ID) -> dict[str, object]:
    return {
        "song_id": song_id,
        "travel_time_ms": 1200,
        "global_offset_ms": 0,
        "judgement_windows_ms": {"perfect": 50, "good": 100},
        "left": [1000, 2000, 3000],
        "right": [1500, 2500],
    }


def _write_chart(tmp_path: Path, payload: dict[str, object]) -> Path:
    chart_path = tmp_path / "chart.json"
    chart_path.write_text(json.dumps(payload), encoding="utf-8")
    return chart_path


def test_load_chart_accepts_independent_lanes(tmp_path: Path) -> None:
    chart = load_chart(_write_chart(tmp_path, _base_chart_payload()))

    assert chart.song_id == TEST_SONG_ID
    assert chart.travel_time_ms == 1200
    assert chart.global_offset_ms == 0
    assert chart.judgement_windows_ms.perfect == 50
    assert chart.judgement_windows_ms.good == 100
    assert chart.left == [1000, 2000, 3000]
    assert chart.right == [1500, 2500]


@pytest.mark.parametrize(
    ("field_name", "field_value"),
    [
        ("travel_time_ms", -1),
        ("judgement_windows_ms", {"perfect": -1, "good": 100}),
        ("left", [-1, 1000]),
    ],
)
def test_load_chart_rejects_negative_timings(
    tmp_path: Path,
    field_name: str,
    field_value: object,
) -> None:
    payload = _base_chart_payload()
    payload[field_name] = field_value

    with pytest.raises(ValidationError):
        load_chart(_write_chart(tmp_path, payload))


def test_load_chart_rejects_zero_travel_time(tmp_path: Path) -> None:
    payload = _base_chart_payload()
    payload["travel_time_ms"] = 0

    with pytest.raises(ValidationError):
        load_chart(_write_chart(tmp_path, payload))


@pytest.mark.parametrize(
    "windows",
    [
        {"perfect": 0, "good": 100},
        {"perfect": 50, "good": 0},
        {"perfect": -1, "good": 100},
        {"perfect": 50, "good": -1},
    ],
)
def test_load_chart_rejects_zero_or_negative_judgement_windows(
    tmp_path: Path,
    windows: dict[str, int],
) -> None:
    payload = _base_chart_payload()
    payload["judgement_windows_ms"] = windows

    with pytest.raises(ValidationError):
        load_chart(_write_chart(tmp_path, payload))


def test_load_chart_rejects_good_window_less_than_perfect(tmp_path: Path) -> None:
    payload = _base_chart_payload()
    payload["judgement_windows_ms"] = {"perfect": 60, "good": 50}

    with pytest.raises(ValidationError):
        load_chart(_write_chart(tmp_path, payload))


def test_load_chart_accepts_negative_global_offset(tmp_path: Path) -> None:
    payload = _base_chart_payload()
    payload["global_offset_ms"] = -120

    chart = load_chart(_write_chart(tmp_path, payload))

    assert chart.global_offset_ms == -120
