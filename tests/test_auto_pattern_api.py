import json
from pathlib import Path

import pytest

from rythm_jump.api import charts as charts_module

TEST_SONG_ID = "auto-pattern-song"
UNEXPECTED_EIGHTH_NOTES_MS = (600, 1100)


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


def test_auto_pattern_generation_uses_full_beats_without_running_analysis(
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
        "resolve_playback_duration_ms",
        lambda _chart, _audio_path: 2000,
    )
    monkeypatch.setattr(
        charts_module,
        "_analyze_audio_with_librosa",
        lambda _audio_path: pytest.fail("auto-pattern should not run audio analysis"),
    )

    payload = charts_module.auto_generate_chart_pattern(TEST_SONG_ID)

    assert payload["ok"] is True
    assert payload["analysis_generated"] is False
    assert payload["pattern"] == "beat"
    assert payload["left"] == [0, 1000, 2000]
    assert payload["right"] == [500, 1500]

    persisted = json.loads(chart_path.read_text(encoding="utf-8"))
    assert persisted["left"] == []
    assert persisted["right"] == []
    assert "audio_analysis" not in persisted


def test_auto_pattern_generation_can_target_bar_downbeats_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    song_dir = tmp_path / TEST_SONG_ID
    song_dir.mkdir(parents=True)
    chart_path = song_dir / "chart.json"
    payload = _chart_payload(TEST_SONG_ID)
    payload["global_offset_ms"] = 100
    chart_path.write_text(json.dumps(payload), encoding="utf-8")
    (song_dir / "audio.mp3").write_bytes(b"fake-mp3")

    monkeypatch.setattr(charts_module, "_charts_root_dir", lambda: tmp_path)
    monkeypatch.setattr(
        charts_module,
        "resolve_playback_duration_ms",
        lambda _chart, _audio_path: 4500,
    )

    generated = charts_module.auto_generate_chart_pattern(
        TEST_SONG_ID,
        charts_module.AutoPatternRequest(pattern="bar"),
    )

    assert generated["ok"] is True
    assert generated["pattern"] == "bar"
    assert generated["left"] == [100, 4100]
    assert generated["right"] == [2100]

    combined_notes = generated["left"] + generated["right"]
    assert sorted(combined_notes) == [100, 2100, 4100]
    for unexpected_note_ms in UNEXPECTED_EIGHTH_NOTES_MS:
        assert unexpected_note_ms not in combined_notes
