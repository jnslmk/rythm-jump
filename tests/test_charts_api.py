import json
from pathlib import Path

from fastapi.testclient import TestClient

from rythm_jump.api import charts as charts_module
from rythm_jump.main import app


def _chart_payload(song_id: str) -> dict[str, object]:
    return {
        "song_id": song_id,
        "bpm": 120.0,
        "travel_time_ms": 1200,
        "global_offset_ms": 0,
        "judgement_windows_ms": {"perfect": 50, "good": 100},
        "left": [100, 200],
        "right": [150, 250],
    }


def test_put_chart_rejects_unknown_song_id(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(charts_module, "_charts_root_dir", lambda: tmp_path)

    with TestClient(app) as client:
        response = client.put("/api/charts/missing", json=_chart_payload("missing"))

    assert response.status_code == 404
    assert response.json() == {"detail": "unknown_song_id"}


def test_put_chart_writes_chart_for_existing_song_dir(
    tmp_path: Path, monkeypatch
) -> None:
    song_dir = tmp_path / "demo"
    song_dir.mkdir(parents=True)
    monkeypatch.setattr(charts_module, "_charts_root_dir", lambda: tmp_path)

    payload = _chart_payload("demo")

    with TestClient(app) as client:
        response = client.put("/api/charts/demo", json=payload)

    assert response.status_code == 200
    assert response.json() == {"ok": True, "song_id": "demo"}

    chart_path = song_dir / "chart.json"
    assert chart_path.exists()
    assert json.loads(chart_path.read_text(encoding="utf-8")) == payload
