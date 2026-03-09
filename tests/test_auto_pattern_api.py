import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from rythm_jump.api import charts as charts_module
from rythm_jump.main import app

TEST_SONG_ID = "auto-pattern-song"
HTTP_OK = 200
STRONG_BEAT_TIMES = {0, 1000, 2000, 3000}
WEAK_BEAT_TIMES = {250, 750, 1250, 1750, 2250, 2750, 3250, 3750}


def _analysis_payload() -> dict[str, object]:
    beat_times_ms = [
        0,
        250,
        500,
        750,
        1000,
        1250,
        1500,
        1750,
        2000,
        2250,
        2500,
        2750,
        3000,
        3250,
        3500,
        3750,
    ]
    descriptors = []
    for beat_time_ms in beat_times_ms:
        is_strong = beat_time_ms in STRONG_BEAT_TIMES
        descriptors.append(
            {
                "time_ms": beat_time_ms,
                "onset_strength": 0.95 if is_strong else 0.18,
                "spectral_centroid_hz": 520.0 if is_strong else 2100.0,
                "spectral_bandwidth_hz": 840.0 if is_strong else 2500.0,
                "spectral_rolloff_hz": 1900.0 if is_strong else 6100.0,
                "rms": 0.82 if is_strong else 0.2,
                "band_energy": {
                    "low": 0.74 if is_strong else 0.18,
                    "mid": 0.2 if is_strong else 0.28,
                    "high": 0.06 if is_strong else 0.54,
                },
                "dominant_band": "low" if is_strong else "high",
                "color_hint": "#60a5fa" if is_strong else "#f472b6",
            },
        )
    return {
        "version": "librosa-v1",
        "sample_rate_hz": 22050,
        "hop_length": 512,
        "frame_length_ms": 23,
        "tempo_bpm": 120.0,
        "beat_times_ms": beat_times_ms,
        "beat_descriptors": descriptors,
    }


def _chart_payload(song_id: str) -> dict[str, object]:
    return {
        "song_id": song_id,
        "bpm": 120.0,
        "travel_time_ms": 1200,
        "global_offset_ms": 0,
        "judgement_windows_ms": {"perfect": 50, "good": 100},
        "left": [],
        "right": [],
    }


def test_auto_pattern_generation_prefers_strong_low_band_beats_and_keeps_chart_unsaved(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    song_dir = tmp_path / TEST_SONG_ID
    song_dir.mkdir(parents=True)
    chart_path = song_dir / "chart.json"
    chart_path.write_text(json.dumps(_chart_payload(TEST_SONG_ID)), encoding="utf-8")
    (song_dir / "audio.mp3").write_bytes(b"fake-mp3")

    monkeypatch.setattr(charts_module, "_charts_root_dir", lambda: tmp_path)
    monkeypatch.setattr(
        charts_module,
        "_analyze_audio_with_librosa",
        lambda _: charts_module.AudioAnalysis.model_validate(_analysis_payload()),
    )

    with TestClient(app) as client:
        response = client.post(f"/api/charts/{TEST_SONG_ID}/auto-pattern")

    assert response.status_code == HTTP_OK
    payload = response.json()
    assert payload["ok"] is True
    assert payload["analysis_generated"] is True

    combined_notes = set(payload["left"]) | set(payload["right"])
    assert STRONG_BEAT_TIMES.issubset(combined_notes)
    assert len(combined_notes & STRONG_BEAT_TIMES) >= len(
        combined_notes & WEAK_BEAT_TIMES,
    )
    assert abs(len(payload["left"]) - len(payload["right"])) <= 1

    persisted = json.loads(chart_path.read_text(encoding="utf-8"))
    assert persisted["left"] == []
    assert persisted["right"] == []
    assert "audio_analysis" not in persisted
