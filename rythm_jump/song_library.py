"""Song storage helpers shared by the API and runtime."""

from __future__ import annotations

import importlib
import json
import re
from pathlib import Path
from typing import TYPE_CHECKING, Final

from rythm_jump.models.chart import Chart, JudgementWindowsMs

if TYPE_CHECKING:
    from types import ModuleType

    from fastapi import UploadFile

SONG_ID_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_-]+$")


def charts_root_dir() -> Path:
    """Return the repository song library path."""
    return Path(__file__).resolve().parents[1] / "songs"


def song_dir(song_id: str, *, root_dir: Path | None = None) -> Path:
    """Return the song directory for the provided identifier."""
    return (root_dir or charts_root_dir()) / song_id


def chart_path(song_id: str, *, root_dir: Path | None = None) -> Path:
    """Return the chart path for a song identifier."""
    return song_dir(song_id, root_dir=root_dir) / "chart.json"


def audio_file_path(song_id: str, *, root_dir: Path | None = None) -> Path | None:
    """Return the first matching managed audio file for a song."""
    current_song_dir = song_dir(song_id, root_dir=root_dir)
    if not current_song_dir.exists():
        return None

    default_path = current_song_dir / "audio.mp3"
    if default_path.exists():
        return default_path

    for candidate in sorted(current_song_dir.glob("audio.*")):
        if candidate.is_file():
            return candidate

    return None


def list_song_ids(*, root_dir: Path | None = None) -> list[str]:
    """List songs that currently have a chart."""
    library_root = root_dir or charts_root_dir()
    if not library_root.exists():
        return []

    return [
        entry.name
        for entry in library_root.iterdir()
        if entry.is_dir() and (entry / "chart.json").exists()
    ]


def load_chart(path: str | Path) -> Chart:
    """Load and validate a chart from disk."""
    current_chart_path = Path(path)
    with current_chart_path.open("r", encoding="utf-8") as chart_file:
        chart_data = json.load(chart_file)
    return Chart.model_validate(chart_data)


def load_song_chart(song_id: str, *, root_dir: Path | None = None) -> Chart:
    """Load a chart by song identifier."""
    return load_chart(chart_path(song_id, root_dir=root_dir))


def save_chart(chart: Chart, *, root_dir: Path | None = None) -> Path:
    """Persist a validated chart and return its path."""
    current_chart_path = chart_path(chart.song_id, root_dir=root_dir)
    current_chart_path.write_text(
        json.dumps(chart.model_dump(mode="json", exclude_none=True), indent=2),
        encoding="utf-8",
    )
    return current_chart_path


def write_default_chart(song_id: str, *, root_dir: Path | None = None) -> Path:
    """Bootstrap a default empty chart for a song."""
    default_chart = Chart(
        song_id=song_id,
        bpm=120.0,
        travel_time_ms=1200,
        global_offset_ms=0,
        judgement_windows_ms=JudgementWindowsMs(perfect=50, good=100),
        left=[],
        right=[],
    )
    return save_chart(default_chart, root_dir=root_dir)


def ensure_song_chart(song_id: str, *, root_dir: Path | None = None) -> Path:
    """Ensure that a chart exists for the song."""
    current_chart_path = chart_path(song_id, root_dir=root_dir)
    if current_chart_path.exists():
        return current_chart_path
    current_chart_path.parent.mkdir(parents=True, exist_ok=True)
    return write_default_chart(song_id, root_dir=root_dir)


def save_uploaded_audio(
    song_id: str,
    audio: UploadFile,
    *,
    root_dir: Path | None = None,
) -> Path:
    """Persist an uploaded audio file for a song."""
    current_song_dir = song_dir(song_id, root_dir=root_dir)
    current_song_dir.mkdir(parents=True, exist_ok=True)

    filename = audio.filename or "audio.mp3"
    ext = Path(filename).suffix or ".mp3"
    return current_song_dir / f"audio{ext}"


def _load_yt_dlp() -> ModuleType:
    try:
        return importlib.import_module("yt_dlp")
    except ModuleNotFoundError as exc:  # pragma: no cover - environment dependent
        message = "yt_dlp_not_available"
        raise RuntimeError(message) from exc


def download_song_audio(
    song_id: str,
    source_url: str,
    *,
    root_dir: Path | None = None,
) -> Path:
    """Download remote audio into the managed song library."""
    current_song_dir = song_dir(song_id, root_dir=root_dir)
    current_song_dir.mkdir(parents=True, exist_ok=True)
    for existing_audio in current_song_dir.glob("audio.*"):
        if existing_audio.is_file():
            existing_audio.unlink()

    yt_dlp = _load_yt_dlp()
    output_template = str(current_song_dir / "audio.%(ext)s")
    with yt_dlp.YoutubeDL(
        {
            "format": "bestaudio/best",
            "noplaylist": True,
            "no_warnings": True,
            "outtmpl": output_template,
            "quiet": True,
            "restrictfilenames": True,
        },
    ) as downloader:
        downloader.extract_info(source_url, download=True)

    audio_path = audio_file_path(song_id, root_dir=root_dir)
    if audio_path is None:
        message = "downloaded_audio_missing"
        raise ValueError(message)
    return audio_path
