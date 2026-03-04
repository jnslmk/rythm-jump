import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException

from rhythm_jump.models.chart import Chart

router = APIRouter()

_SONG_ID_PATTERN = re.compile(r'^[A-Za-z0-9_-]+$')


def _charts_root_dir() -> Path:
    return Path(__file__).resolve().parents[3] / 'songs'


@router.put('/charts/{song_id}')
def save_chart(song_id: str, chart: Chart) -> dict[str, object]:
    if not _SONG_ID_PATTERN.fullmatch(song_id):
        raise HTTPException(status_code=400, detail='invalid_song_id')

    if chart.song_id != song_id:
        raise HTTPException(status_code=400, detail='song_id_mismatch')

    song_dir = _charts_root_dir() / song_id
    if not song_dir.exists() or not song_dir.is_dir():
        raise HTTPException(status_code=404, detail='unknown_song_id')

    chart_path = song_dir / 'chart.json'
    chart_path.write_text(json.dumps(chart.model_dump(mode='json'), indent=2), encoding='utf-8')

    return {'ok': True, 'song_id': song_id}
