from pathlib import Path

import pytest
from fastapi import HTTPException

from rythm_jump.api import charts


def test_charts_root_dir_points_at_repo_songs() -> None:
    expected = Path(__file__).resolve().parents[1] / "songs"
    assert charts._charts_root_dir() == expected


def test_get_audio_raises_when_missing(tmp_path, monkeypatch) -> None:
    song_root = tmp_path / "songs"
    track = song_root / "missing"
    track.mkdir(parents=True)
    monkeypatch.setattr(charts, "_charts_root_dir", lambda: song_root)
    with pytest.raises(HTTPException) as exc_info:
        charts.get_audio("missing")
    assert exc_info.value.status_code == 404
