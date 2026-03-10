"""Shared pytest fixtures for the test suite."""

from pathlib import Path

import pytest

from rythm_jump import song_library


@pytest.fixture
def ws_song_library(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Provide an isolated song library for websocket session tests."""
    song_dir = tmp_path / "toxic"
    song_dir.mkdir(parents=True)

    source_chart = Path(__file__).resolve().parents[1] / "songs/toxic/chart.json"
    chart_text = source_chart.read_text(encoding="utf-8")
    (song_dir / "chart.json").write_text(chart_text, encoding="utf-8")
    (song_dir / "audio.mp3").write_bytes(b"ID3")

    monkeypatch.setattr(song_library, "charts_root_dir", lambda: tmp_path)
    return tmp_path
