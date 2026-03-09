import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from rythm_jump.engine.chart_loader import load_chart

TRAVEL_TIME_MS = 1200
PERFECT_WINDOW_MS = 50
GOOD_WINDOW_MS = 100
NEGATIVE_GLOBAL_OFFSET_MS = -120
DETECTED_BPM = 128.0
ANALYSIS_DURATION_MS = 180000
DEFAULT_LEFT = [1000, 2000, 3000]
DEFAULT_RIGHT = [1500, 2500]


TEST_SONG_ID = "sample-song"


def _base_chart_payload(song_id: str = TEST_SONG_ID) -> dict[str, object]:
    return {
        "song_id": song_id,
        "travel_time_ms": TRAVEL_TIME_MS,
        "global_offset_ms": 0,
        "judgement_windows_ms": {"perfect": PERFECT_WINDOW_MS, "good": GOOD_WINDOW_MS},
        "left": DEFAULT_LEFT,
        "right": DEFAULT_RIGHT,
    }


def _write_chart(tmp_path: Path, payload: dict[str, object]) -> Path:
    chart_path = tmp_path / "chart.json"
    chart_path.write_text(json.dumps(payload), encoding="utf-8")
    return chart_path


def test_load_chart_accepts_independent_lanes(tmp_path: Path) -> None:
    chart = load_chart(_write_chart(tmp_path, _base_chart_payload()))

    assert chart.song_id == TEST_SONG_ID
    assert chart.travel_time_ms == TRAVEL_TIME_MS
    assert chart.global_offset_ms == 0
    assert chart.judgement_windows_ms.perfect == PERFECT_WINDOW_MS
    assert chart.judgement_windows_ms.good == GOOD_WINDOW_MS
    assert chart.left == DEFAULT_LEFT
    assert chart.right == DEFAULT_RIGHT


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
    payload["global_offset_ms"] = NEGATIVE_GLOBAL_OFFSET_MS

    chart = load_chart(_write_chart(tmp_path, payload))

    assert chart.global_offset_ms == NEGATIVE_GLOBAL_OFFSET_MS


def test_load_chart_accepts_audio_analysis_metadata(tmp_path: Path) -> None:
    payload = _base_chart_payload()
    payload["audio_analysis"] = {
        "version": "librosa-v1",
        "duration_ms": ANALYSIS_DURATION_MS,
        "sample_rate_hz": 22050,
        "hop_length": 512,
        "frame_length_ms": 23,
        "tempo_bpm": DETECTED_BPM,
        "beat_times_ms": [500, 1000],
        "beat_descriptors": [
            {
                "time_ms": 500,
                "onset_strength": 0.32,
                "spectral_centroid_hz": 710.0,
                "spectral_bandwidth_hz": 920.0,
                "spectral_rolloff_hz": 2050.0,
                "rms": 0.42,
                "band_energy": {"low": 0.4, "mid": 0.5, "high": 0.1},
                "dominant_band": "mid",
                "color_hint": "#2dd4bf",
            },
        ],
    }

    chart = load_chart(_write_chart(tmp_path, payload))

    assert chart.audio_analysis is not None
    assert chart.audio_analysis.duration_ms == ANALYSIS_DURATION_MS
    assert chart.audio_analysis.tempo_bpm == DETECTED_BPM
    assert chart.audio_analysis.beat_descriptors[0].dominant_band == "mid"
