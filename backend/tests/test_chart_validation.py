from pathlib import Path

from rhythm_jump.engine.chart_loader import load_chart


def test_load_chart_accepts_independent_lanes() -> None:
    chart = load_chart(Path('songs/demo/chart.json'))

    assert chart.song_id == 'demo'
    assert chart.travel_time_ms == 1200
    assert chart.global_offset_ms == 0
    assert chart.judgement_windows_ms.perfect == 50
    assert chart.judgement_windows_ms.good == 100
    assert chart.left == [1000, 2000, 3000]
    assert chart.right == [1500, 2500]
