"""Shared pytest fixtures for the test suite."""

import json
from pathlib import Path

import pytest

from rythm_jump import song_library
from rythm_jump.api import session_stream
from rythm_jump.bootstrap import RuntimeStack, build_runtime_stack
from rythm_jump.hw.audio_playback import NoOpAudioPlayer
from rythm_jump.main import app


@pytest.fixture(autouse=True)
def test_runtime_uses_noop_audio(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep tests independent from local audio backend availability."""

    def build_test_runtime_stack() -> RuntimeStack:
        return build_runtime_stack(audio_player=NoOpAudioPlayer())

    monkeypatch.setattr("rythm_jump.main.build_runtime_stack", build_test_runtime_stack)
    app.state.runtime = None
    app.state.input_source = None
    app.state.polling_task = None


@pytest.fixture
def ws_song_library(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Provide an isolated song library for websocket session tests."""
    song_dir = tmp_path / "toxic"
    song_dir.mkdir(parents=True)

    chart_payload = {
        "song_id": "toxic",
        "bpm": 120.0,
        "travel_time_ms": 1200,
        "global_offset_ms": 0,
        "judgement_windows_ms": {"perfect": 50, "good": 100},
        "left": [1000, 3000],
        "right": [2000, 4000],
    }
    (song_dir / "chart.json").write_text(
        json.dumps(chart_payload),
        encoding="utf-8",
    )
    (song_dir / "audio.mp3").write_bytes(b"ID3")

    monkeypatch.setattr(song_library, "charts_root_dir", lambda: tmp_path)
    monkeypatch.setattr(session_stream, "charts_root_dir", lambda: tmp_path)

    def resolve_playback_duration_ms(*, chart: object, audio_path: object) -> int:
        _ = (chart, audio_path)
        return 5200

    monkeypatch.setattr(
        session_stream,
        "resolve_playback_duration_ms",
        lambda chart, audio_path: resolve_playback_duration_ms(
            chart=chart,
            audio_path=audio_path,
        ),
    )
    return tmp_path
