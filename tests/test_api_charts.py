from pathlib import Path

import pytest
from fastapi import HTTPException

from rythm_jump.api import charts

HTTP_NOT_FOUND = 404


def test_charts_root_dir_points_at_repo_songs() -> None:
    expected = Path(__file__).resolve().parents[1] / "songs"
    assert charts._charts_root_dir() == expected  # noqa: SLF001


def test_get_audio_raises_when_missing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    song_root = tmp_path / "songs"
    track = song_root / "missing"
    track.mkdir(parents=True)
    monkeypatch.setattr(charts, "_charts_root_dir", lambda: song_root)
    with pytest.raises(HTTPException) as exc_info:
        charts.get_audio("missing")
    assert exc_info.value.status_code == HTTP_NOT_FOUND
