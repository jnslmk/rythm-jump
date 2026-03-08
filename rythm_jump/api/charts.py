"""FastAPI endpoints for uploading and querying song charts."""

import collections
import json
import re
import warnings
from collections import abc as collections_abc
from pathlib import Path
from typing import Annotated, Final

import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from madmom.features.beats import RNNBeatProcessor
from madmom.features.tempo import TempoEstimationProcessor
from pydantic import ValidationError

from rythm_jump.models.chart import Chart, JudgementWindowsMs

router = APIRouter()

_MIN_BPM: Final[int] = 60
_MAX_BPM: Final[int] = 180


if not hasattr(collections, "MutableSequence"):
    collections.MutableSequence = collections_abc.MutableSequence


visible_deprecation_warning = getattr(
    np,
    "VisibleDeprecationWarning",
    DeprecationWarning,
)
warnings.filterwarnings(
    "ignore",
    category=visible_deprecation_warning,
    message=(
        r"dtype\(\): align should be passed as Python or NumPy boolean "
        r"but got `align=0`\..*"
    ),
)


_SONG_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def _charts_root_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "songs"


def _audio_file_for_song(song_id: str) -> Path | None:
    song_dir = _charts_root_dir() / song_id
    if not song_dir.exists():
        return None

    default_path = song_dir / "audio.mp3"
    if default_path.exists():
        return default_path

    for candidate in sorted(song_dir.glob("audio.*")):
        if candidate.is_file():
            return candidate

    return None


def _estimate_bpm_from_audio(audio_path: Path) -> float:
    beat_processor = RNNBeatProcessor()
    tempo_processor = TempoEstimationProcessor()
    activations = beat_processor(str(audio_path))
    tempos = tempo_processor(activations)
    if not tempos:
        message = "no_tempo_detected"
        raise ValueError(message)

    bpm_candidate = float(tempos[0][0])
    while bpm_candidate < _MIN_BPM:
        bpm_candidate *= 2
    while bpm_candidate > _MAX_BPM:
        bpm_candidate /= 2

    return round(bpm_candidate, 1)


@router.get("/songs")
def list_songs() -> list[str]:
    """Return the identifiers of all songs that have a chart."""
    songs_dir = _charts_root_dir()
    if not songs_dir.exists():
        return []

    return [
        entry.name
        for entry in songs_dir.iterdir()
        if entry.is_dir() and (entry / "chart.json").exists()
    ]


@router.get("/charts/{song_id}")
def get_chart(song_id: str) -> Chart:
    """Load a chart for ``song_id`` or raise an HTTP error."""
    if not _SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail="invalid_song_id")

    chart_path = _charts_root_dir() / song_id / "chart.json"
    if not chart_path.exists():
        raise HTTPException(status_code=404, detail="unknown_song_id")

    try:
        data = json.loads(chart_path.read_text(encoding="utf-8"))
        return Chart.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=500, detail="failed_to_load_chart") from exc


@router.get("/songs/{song_id}/audio")
def get_audio(song_id: str) -> FileResponse:
    """Return the uploaded audio file for ``song_id`` if it exists."""
    if not _SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail="invalid_song_id")

    audio_path = _audio_file_for_song(song_id)
    if not audio_path:
        raise HTTPException(status_code=404, detail="audio_not_found")

    return FileResponse(audio_path)


@router.post("/songs")
async def upload_song(
    song_id: Annotated[str, Form(...)],
    audio: Annotated[UploadFile, File(...)],
) -> dict[str, object]:
    """Upload an audio file and create a default chart if needed."""
    if not _SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail="invalid_song_id")

    song_dir = _charts_root_dir() / song_id
    song_dir.mkdir(parents=True, exist_ok=True)

    filename = audio.filename or "audio.mp3"
    ext = Path(filename).suffix or ".mp3"
    audio_path = song_dir / f"audio{ext}"

    with audio_path.open("wb") as buffer:
        buffer.write(await audio.read())

    chart_path = song_dir / "chart.json"
    if not chart_path.exists():
        default_chart = Chart(
            song_id=song_id,
            bpm=120.0,
            travel_time_ms=1200,
            global_offset_ms=0,
            judgement_windows_ms=JudgementWindowsMs(perfect=50, good=100),
            left=[],
            right=[],
        )
        chart_path.write_text(
            json.dumps(default_chart.model_dump(mode="json"), indent=2),
            encoding="utf-8",
        )

    return {"ok": True, "song_id": song_id}


@router.put("/charts/{song_id}")
def save_chart(song_id: str, chart: Chart) -> dict[str, object]:
    """Persist ``chart`` if it matches ``song_id`` and the folder exists."""
    if not _SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail="invalid_song_id")

    if chart.song_id != song_id:
        raise HTTPException(status_code=400, detail="song_id_mismatch")

    song_dir = _charts_root_dir() / song_id
    if not song_dir.exists() or not song_dir.is_dir():
        raise HTTPException(status_code=404, detail="unknown_song_id")

    chart_path = song_dir / "chart.json"
    chart_path.write_text(
        json.dumps(chart.model_dump(mode="json"), indent=2),
        encoding="utf-8",
    )

    return {"ok": True, "song_id": song_id}


@router.get("/charts/{song_id}/tempo")
def analyze_chart_tempo(song_id: str) -> dict[str, float]:
    """Estimate the tempo of a song and return it."""
    if not _SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail="invalid_song_id")

    audio_path = _audio_file_for_song(song_id)
    if not audio_path:
        raise HTTPException(status_code=404, detail="audio_not_found")

    try:
        bpm = _estimate_bpm_from_audio(audio_path)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="tempo_analysis_failed") from exc

    return {"bpm": bpm}
