import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from rhythm_jump.engine.chart_loader import load_chart


def _demo_chart_path() -> Path:
    return Path(__file__).resolve().parents[2] / 'songs' / 'demo' / 'chart.json'


def _base_chart_payload() -> dict[str, object]:
    return {
        'song_id': 'demo',
        'travel_time_ms': 1200,
        'global_offset_ms': 0,
        'judgement_windows_ms': {'perfect': 50, 'good': 100},
        'left': [1000, 2000, 3000],
        'right': [1500, 2500],
    }


def _write_chart(tmp_path: Path, payload: dict[str, object]) -> Path:
    chart_path = tmp_path / 'chart.json'
    chart_path.write_text(json.dumps(payload), encoding='utf-8')
    return chart_path


def test_load_chart_accepts_independent_lanes() -> None:
    chart = load_chart(_demo_chart_path())

    assert chart.song_id == 'demo'
    assert chart.travel_time_ms == 1200
    assert chart.global_offset_ms == 0
    assert chart.judgement_windows_ms.perfect == 50
    assert chart.judgement_windows_ms.good == 100
    assert chart.left == [1000, 2000, 3000]
    assert chart.right == [1500, 2500]


def test_load_chart_rejects_both_lanes_empty(tmp_path: Path) -> None:
    payload = _base_chart_payload()
    payload['left'] = []
    payload['right'] = []

    with pytest.raises(ValidationError):
        load_chart(_write_chart(tmp_path, payload))


@pytest.mark.parametrize(
    ('field_name', 'field_value'),
    [
        ('travel_time_ms', -1),
        ('judgement_windows_ms', {'perfect': -1, 'good': 100}),
        ('left', [-1, 1000]),
    ],
)
def test_load_chart_rejects_negative_timings(
    tmp_path: Path,
    field_name: str,
    field_value: object,
) -> None:
    payload = _base_chart_payload()
    payload[field_name] = field_value

    with pytest.raises(ValidationError):
        load_chart(_write_chart(tmp_path, payload))
