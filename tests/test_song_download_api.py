import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from rythm_jump.api import charts as charts_module
from rythm_jump.main import app

DEFAULT_TRAVEL_TIME_MS = 1200
HTTP_BAD_GATEWAY = 502
HTTP_INTERNAL_SERVER_ERROR = 500
HTTP_OK = 200


def test_download_song_saves_audio_and_bootstraps_chart(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(charts_module, "_charts_root_dir", lambda: tmp_path)

    def fake_download(song_id: str, source_url: str) -> Path:
        assert song_id == "downloaded-song"
        assert source_url == "https://soundcloud.com/example/track"
        song_dir = tmp_path / song_id
        song_dir.mkdir(parents=True, exist_ok=True)
        audio_path = song_dir / "audio.m4a"
        audio_path.write_bytes(b"audio")
        return audio_path

    monkeypatch.setattr(charts_module, "_download_song_audio", fake_download)

    with TestClient(app) as client:
        response = client.post(
            "/api/songs/download",
            json={
                "song_id": "downloaded-song",
                "source_url": "https://soundcloud.com/example/track",
            },
        )

    assert response.status_code == HTTP_OK
    assert response.json() == {
        "ok": True,
        "song_id": "downloaded-song",
        "audio_filename": "audio.m4a",
    }

    chart_path = tmp_path / "downloaded-song" / "chart.json"
    assert chart_path.exists()
    chart_payload = json.loads(chart_path.read_text(encoding="utf-8"))
    assert chart_payload["song_id"] == "downloaded-song"
    assert chart_payload["travel_time_ms"] == DEFAULT_TRAVEL_TIME_MS


def test_download_song_reports_missing_downloader(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(charts_module, "_charts_root_dir", lambda: tmp_path)
    monkeypatch.setattr(
        charts_module,
        "_download_song_audio",
        lambda *_args: (_ for _ in ()).throw(RuntimeError("yt_dlp_not_available")),
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/songs/download",
            json={
                "song_id": "downloaded-song",
                "source_url": "https://soundcloud.com/example/track",
            },
        )

    assert response.status_code == HTTP_INTERNAL_SERVER_ERROR
    assert response.json() == {"detail": "downloader_unavailable"}


def test_download_song_reports_download_failures(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(charts_module, "_charts_root_dir", lambda: tmp_path)
    monkeypatch.setattr(
        charts_module,
        "_download_song_audio",
        lambda *_args: (_ for _ in ()).throw(ValueError("download_failed")),
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/songs/download",
            json={
                "song_id": "downloaded-song",
                "source_url": "https://soundcloud.com/example/track",
            },
        )

    assert response.status_code == HTTP_BAD_GATEWAY
    assert response.json() == {"detail": "song_download_failed"}
