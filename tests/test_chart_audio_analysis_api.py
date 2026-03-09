import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from rythm_jump.api import charts as charts_module
from rythm_jump.main import app

TEST_SONG_ID = "analysis-song"
HTTP_OK = 200
DETECTED_BPM = 128.0
EXPECTED_GLOBAL_OFFSET_MS = 47


def _analysis_payload() -> dict[str, object]:
    return {
        "version": "librosa-v1",
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
                "band_energy": {
                    "low": 0.4,
                    "mid": 0.5,
                    "high": 0.1,
                },
                "dominant_band": "mid",
                "color_hint": "#2dd4bf",
            },
            {
                "time_ms": 1000,
                "onset_strength": 0.28,
                "spectral_centroid_hz": 650.0,
                "spectral_bandwidth_hz": 810.0,
                "spectral_rolloff_hz": 1980.0,
                "rms": 0.36,
                "band_energy": {
                    "low": 0.58,
                    "mid": 0.34,
                    "high": 0.08,
                },
                "dominant_band": "low",
                "color_hint": "#60a5fa",
            },
        ],
    }


def _chart_payload(song_id: str) -> dict[str, object]:
    return {
        "song_id": song_id,
        "bpm": 120.0,
        "travel_time_ms": 1200,
        "global_offset_ms": 0,
        "judgement_windows_ms": {"perfect": 50, "good": 100},
        "left": [100, 200],
        "right": [150, 250],
    }


def test_post_audio_analysis_persists_into_chart(
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
        response = client.post(f"/api/charts/{TEST_SONG_ID}/analysis")

    assert response.status_code == HTTP_OK
    payload = response.json()
    assert payload["ok"] is True
    assert payload["song_id"] == TEST_SONG_ID
    assert payload["bpm"] == DETECTED_BPM
    assert payload["global_offset_ms"] == EXPECTED_GLOBAL_OFFSET_MS
    assert payload["analysis"]["beat_times_ms"] == [500, 1000]

    persisted = json.loads(chart_path.read_text(encoding="utf-8"))
    assert persisted["bpm"] == DETECTED_BPM
    assert persisted["global_offset_ms"] == EXPECTED_GLOBAL_OFFSET_MS
    assert persisted["audio_analysis"]["version"] == "librosa-v1"


def test_get_tempo_uses_librosa_analysis(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    song_dir = tmp_path / TEST_SONG_ID
    song_dir.mkdir(parents=True)
    (song_dir / "chart.json").write_text(
        json.dumps(_chart_payload(TEST_SONG_ID)),
        encoding="utf-8",
    )
    (song_dir / "audio.mp3").write_bytes(b"fake-mp3")

    monkeypatch.setattr(charts_module, "_charts_root_dir", lambda: tmp_path)
    monkeypatch.setattr(
        charts_module,
        "_analyze_audio_with_librosa",
        lambda _: charts_module.AudioAnalysis.model_validate(_analysis_payload()),
    )

    with TestClient(app) as client:
        response = client.get(f"/api/charts/{TEST_SONG_ID}/tempo")

    assert response.status_code == HTTP_OK
    assert response.json() == {"bpm": DETECTED_BPM}


def test_post_auto_pattern_returns_generated_notes_without_persisting(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    song_dir = tmp_path / TEST_SONG_ID
    song_dir.mkdir(parents=True)
    chart_path = song_dir / "chart.json"
    payload = _chart_payload(TEST_SONG_ID)
    payload["audio_analysis"] = _analysis_payload()
    chart_path.write_text(json.dumps(payload), encoding="utf-8")
    (song_dir / "audio.mp3").write_bytes(b"fake-mp3")

    monkeypatch.setattr(charts_module, "_charts_root_dir", lambda: tmp_path)

    with TestClient(app) as client:
        response = client.post(f"/api/charts/{TEST_SONG_ID}/auto-pattern")

    assert response.status_code == HTTP_OK
    generated = response.json()
    assert generated["ok"] is True
    assert generated["song_id"] == TEST_SONG_ID
    assert generated["analysis_generated"] is False
    assert len(generated["left"]) > 0
    assert len(generated["right"]) > 0
    assert abs(len(generated["left"]) - len(generated["right"])) <= 1

    persisted = json.loads(chart_path.read_text(encoding="utf-8"))
    assert persisted["left"] == payload["left"]
    assert persisted["right"] == payload["right"]
