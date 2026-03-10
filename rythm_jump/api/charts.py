"""FastAPI endpoints for uploading and querying song charts."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ValidationError

from rythm_jump.audio_analysis import (
    analyze_audio_with_librosa,
    estimate_global_offset_ms,
    generate_auto_pattern_from_analysis,
)
from rythm_jump.models.chart import AudioAnalysis, Chart  # noqa: TC001
from rythm_jump.song_library import (
    SONG_ID_PATTERN,
    audio_file_path,
    chart_path,
    charts_root_dir,
    download_song_audio,
    ensure_song_chart,
    list_song_ids,
    load_chart,
    load_song_chart,
    save_chart,
    save_uploaded_audio,
    song_dir,
)

router = APIRouter()

if TYPE_CHECKING:
    from pathlib import Path


class SongDownloadRequest(BaseModel):
    """Describe a remote audio download request."""

    song_id: str
    source_url: str


def _charts_root_dir() -> Path:
    return charts_root_dir()


def _audio_file_for_song(song_id: str) -> Path | None:
    return audio_file_path(song_id, root_dir=_charts_root_dir())


def _download_song_audio(song_id: str, source_url: str) -> Path:
    return download_song_audio(song_id, source_url, root_dir=_charts_root_dir())


def _analyze_audio_with_librosa(audio_path: Path) -> AudioAnalysis:
    return analyze_audio_with_librosa(audio_path)


def _validate_song_id(song_id: str) -> None:
    if not SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail="invalid_song_id")


@router.get("/songs")
def list_songs() -> list[str]:
    """Return the identifiers of all songs that have a chart."""
    return list_song_ids(root_dir=_charts_root_dir())


@router.get("/charts/{song_id}")
def get_chart(song_id: str) -> Chart:
    """Load a chart for ``song_id`` or raise an HTTP error."""
    _validate_song_id(song_id)
    current_chart_path = chart_path(song_id, root_dir=_charts_root_dir())
    if not current_chart_path.exists():
        raise HTTPException(status_code=404, detail="unknown_song_id")

    try:
        return load_song_chart(song_id, root_dir=_charts_root_dir())
    except (OSError, ValidationError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="failed_to_load_chart") from exc


@router.get("/songs/{song_id}/audio")
def get_audio(song_id: str) -> FileResponse:
    """Return the uploaded audio file for ``song_id`` if it exists."""
    _validate_song_id(song_id)
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
    _validate_song_id(song_id)

    audio_path = save_uploaded_audio(song_id, audio, root_dir=_charts_root_dir())
    with audio_path.open("wb") as buffer:
        buffer.write(await audio.read())

    ensure_song_chart(song_id, root_dir=_charts_root_dir())
    return {"ok": True, "song_id": song_id}


@router.post("/songs/download")
def download_song(request: SongDownloadRequest) -> dict[str, object]:
    """Download remote audio into a managed song slot."""
    _validate_song_id(request.song_id)

    source_url = request.source_url.strip()
    if not source_url:
        raise HTTPException(status_code=400, detail="missing_source_url")

    try:
        audio_path = _download_song_audio(request.song_id, source_url)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail="downloader_unavailable") from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="song_download_failed") from exc

    ensure_song_chart(request.song_id, root_dir=_charts_root_dir())
    return {
        "ok": True,
        "song_id": request.song_id,
        "audio_filename": audio_path.name,
    }


@router.put("/charts/{song_id}")
def put_chart(song_id: str, chart: Chart) -> dict[str, object]:
    """Persist ``chart`` if it matches ``song_id`` and the folder exists."""
    _validate_song_id(song_id)
    if chart.song_id != song_id:
        raise HTTPException(status_code=400, detail="song_id_mismatch")

    current_song_dir = song_dir(song_id, root_dir=_charts_root_dir())
    if not current_song_dir.exists() or not current_song_dir.is_dir():
        raise HTTPException(status_code=404, detail="unknown_song_id")

    save_chart(chart, root_dir=_charts_root_dir())
    return {"ok": True, "song_id": song_id}


@router.get("/charts/{song_id}/tempo")
def analyze_chart_tempo(song_id: str) -> dict[str, float]:
    """Estimate the tempo of a song and return it."""
    _validate_song_id(song_id)
    audio_path = _audio_file_for_song(song_id)
    if not audio_path:
        raise HTTPException(status_code=404, detail="audio_not_found")

    try:
        bpm = _analyze_audio_with_librosa(audio_path).tempo_bpm
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail="analysis_backend_unavailable",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="tempo_analysis_failed") from exc

    return {"bpm": bpm}


@router.post("/charts/{song_id}/analysis")
def analyze_chart_audio(song_id: str) -> dict[str, object]:
    """Run offline librosa analysis, persist metadata, and return it."""
    _validate_song_id(song_id)
    current_chart_path = chart_path(song_id, root_dir=_charts_root_dir())
    if not current_chart_path.exists():
        raise HTTPException(status_code=404, detail="unknown_song_id")

    audio_path = _audio_file_for_song(song_id)
    if not audio_path:
        raise HTTPException(status_code=404, detail="audio_not_found")

    try:
        current_chart = load_chart(current_chart_path)
    except (OSError, ValidationError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="failed_to_load_chart") from exc

    try:
        analysis = _analyze_audio_with_librosa(audio_path)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail="analysis_backend_unavailable",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="audio_analysis_failed") from exc

    current_chart.audio_analysis = analysis
    current_chart.bpm = analysis.tempo_bpm
    current_chart.global_offset_ms = estimate_global_offset_ms(
        analysis.beat_times_ms,
        analysis.tempo_bpm,
    )
    save_chart(current_chart, root_dir=_charts_root_dir())

    return {
        "ok": True,
        "song_id": song_id,
        "bpm": analysis.tempo_bpm,
        "global_offset_ms": current_chart.global_offset_ms,
        "analysis": analysis.model_dump(mode="json"),
    }


@router.post("/charts/{song_id}/auto-pattern")
def auto_generate_chart_pattern(song_id: str) -> dict[str, object]:
    """Generate a beat-balanced jump pattern from audio analysis."""
    _validate_song_id(song_id)
    current_chart_path = chart_path(song_id, root_dir=_charts_root_dir())
    if not current_chart_path.exists():
        raise HTTPException(status_code=404, detail="unknown_song_id")

    audio_path = _audio_file_for_song(song_id)
    if not audio_path:
        raise HTTPException(status_code=404, detail="audio_not_found")

    try:
        current_chart = load_chart(current_chart_path)
    except (OSError, ValidationError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="failed_to_load_chart") from exc

    generated_chart = current_chart.model_copy(deep=True)
    analysis_generated = False
    if generated_chart.audio_analysis is None:
        try:
            generated_chart.audio_analysis = _analyze_audio_with_librosa(audio_path)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=500,
                detail="analysis_backend_unavailable",
            ) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=500,
                detail="audio_analysis_failed",
            ) from exc
        generated_chart.bpm = generated_chart.audio_analysis.tempo_bpm
        generated_chart.global_offset_ms = estimate_global_offset_ms(
            generated_chart.audio_analysis.beat_times_ms,
            generated_chart.audio_analysis.tempo_bpm,
        )
        analysis_generated = True

    if generated_chart.audio_analysis is None:
        raise HTTPException(status_code=500, detail="audio_analysis_missing")

    generated_chart.left, generated_chart.right = generate_auto_pattern_from_analysis(
        generated_chart.audio_analysis,
    )
    return {
        "ok": True,
        "song_id": song_id,
        "analysis_generated": analysis_generated,
        "bpm": generated_chart.bpm,
        "global_offset_ms": generated_chart.global_offset_ms,
        "left": generated_chart.left,
        "right": generated_chart.right,
        "analysis": generated_chart.audio_analysis.model_dump(mode="json"),
    }
