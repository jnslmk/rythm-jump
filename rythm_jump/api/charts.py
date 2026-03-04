import collections
from collections import abc as collections_abc
import json
import numpy as np
import re
from pathlib import Path

if not hasattr(collections, "MutableSequence"):
    collections.MutableSequence = collections_abc.MutableSequence

if not hasattr(np, "float"):
    setattr(np, "float", float)

if not hasattr(np, "int"):
    setattr(np, "int", int)

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from madmom.features.beats import RNNBeatProcessor
from madmom.features.tempo import TempoEstimationProcessor
from rythm_jump.models.chart import Chart, JudgementWindowsMs


router = APIRouter()

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
    if len(tempos) == 0:
        raise ValueError("no_tempo_detected")

    bpm_candidate = float(tempos[0][0])
    while bpm_candidate < 60:
        bpm_candidate *= 2
    while bpm_candidate > 180:
        bpm_candidate /= 2

    return round(bpm_candidate, 1)


@router.get("/songs")
def list_songs() -> list[str]:
    songs_dir = _charts_root_dir()
    if not songs_dir.exists():
        return []
    return [
        d.name
        for d in songs_dir.iterdir()
        if d.is_dir() and (d / "chart.json").exists()
    ]


@router.get("/charts/{song_id}")
def get_chart(song_id: str) -> Chart:
    if not _SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail="invalid_song_id")

    chart_path = _charts_root_dir() / song_id / "chart.json"
    if not chart_path.exists():
        raise HTTPException(status_code=404, detail="unknown_song_id")

    try:
        data = json.loads(chart_path.read_text(encoding="utf-8"))
        return Chart.model_validate(data)
    except Exception:
        raise HTTPException(status_code=500, detail="failed_to_load_chart")


@router.get("/songs/{song_id}/audio")
def get_audio(song_id: str) -> FileResponse:
    if not _SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail="invalid_song_id")

    audio_path = _audio_file_for_song(song_id)
    if not audio_path:
        raise HTTPException(status_code=404, detail="audio_not_found")

    return FileResponse(audio_path)


@router.post("/songs")
async def upload_song(
    song_id: str = Form(...), audio: UploadFile = File(...)
) -> dict[str, object]:
    if not _SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail="invalid_song_id")

    song_dir = _charts_root_dir() / song_id
    song_dir.mkdir(parents=True, exist_ok=True)

    # Use original extension if available
    filename = audio.filename or "audio.mp3"
    ext = Path(filename).suffix or ".mp3"
    audio_path = song_dir / f"audio{ext}"

    with audio_path.open("wb") as buffer:
        buffer.write(await audio.read())

    # Create default chart if it doesn't exist
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
    if not _SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail="invalid_song_id")

    if chart.song_id != song_id:
        raise HTTPException(status_code=400, detail="song_id_mismatch")

    song_dir = _charts_root_dir() / song_id
    if not song_dir.exists() or not song_dir.is_dir():
        raise HTTPException(status_code=404, detail="unknown_song_id")

    chart_path = song_dir / "chart.json"
    chart_path.write_text(
        json.dumps(chart.model_dump(mode="json"), indent=2), encoding="utf-8"
    )

    return {"ok": True, "song_id": song_id}


@router.get("/charts/{song_id}/tempo")
def analyze_chart_tempo(song_id: str) -> dict[str, float]:
    if not _SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail="invalid_song_id")

    audio_path = _audio_file_for_song(song_id)
    if not audio_path:
        raise HTTPException(status_code=404, detail="audio_not_found")

    try:
        bpm = _estimate_bpm_from_audio(audio_path)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="tempo_analysis_failed") from exc

    return {"bpm": bpm}
