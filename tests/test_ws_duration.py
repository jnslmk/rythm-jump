from pathlib import Path

import pytest

from rythm_jump import audio_analysis
from rythm_jump.models.chart import Chart

ACTUAL_AUDIO_DURATION_MS = 198897
ANALYZED_AUDIO_DURATION_MS = 196185


def _chart_payload() -> dict[str, object]:
    return {
        "song_id": "sample-song",
        "travel_time_ms": 1200,
        "global_offset_ms": 0,
        "judgement_windows_ms": {"perfect": 50, "good": 100},
        "left": [1000],
        "right": [1500],
    }


def test_playback_duration_prefers_audio_file_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    chart = Chart.model_validate(_chart_payload())
    monkeypatch.setattr(
        audio_analysis,
        "audio_duration_ms",
        lambda _path: ACTUAL_AUDIO_DURATION_MS,
    )

    duration_ms = audio_analysis.resolve_playback_duration_ms(chart, Path("audio.mp3"))

    assert duration_ms == ACTUAL_AUDIO_DURATION_MS


def test_playback_duration_falls_back_to_analysis_duration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _chart_payload()
    payload["audio_analysis"] = {
        "version": "librosa-v1",
        "duration_ms": ANALYZED_AUDIO_DURATION_MS,
        "sample_rate_hz": 22050,
        "hop_length": 512,
        "frame_length_ms": 23,
        "tempo_bpm": 143.6,
        "beat_times_ms": [650, ANALYZED_AUDIO_DURATION_MS],
        "beat_descriptors": [
            {
                "time_ms": ANALYZED_AUDIO_DURATION_MS,
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
    chart = Chart.model_validate(payload)
    monkeypatch.setattr(audio_analysis, "audio_duration_ms", lambda _path: 0)

    duration_ms = audio_analysis.resolve_playback_duration_ms(chart, Path("audio.mp3"))

    assert duration_ms == ANALYZED_AUDIO_DURATION_MS
