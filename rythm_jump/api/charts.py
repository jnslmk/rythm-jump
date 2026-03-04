import json
import re
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from rythm_jump.models.chart import Chart, JudgementWindowsMs


router = APIRouter()

_SONG_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def _charts_root_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "songs"


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

    audio_path = _charts_root_dir() / song_id / "audio.mp3"
    if not audio_path.exists():
        # Try any file starting with audio and ending in common formats
        for ext in [".mp3", ".wav", ".ogg", ".aac", ".m4a"]:
            p = _charts_root_dir() / song_id / f"audio{ext}"
            if p.exists():
                return FileResponse(p)
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
