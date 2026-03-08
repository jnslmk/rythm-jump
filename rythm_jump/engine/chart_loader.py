"""Chart-loading helpers for Rhythm Jump."""

import json
from pathlib import Path

from rythm_jump.models.chart import Chart


def load_chart(path: str | Path) -> Chart:
    """Load a chart from disk and validate its contents."""
    chart_path = Path(path)
    with chart_path.open("r", encoding="utf-8") as chart_file:
        chart_data = json.load(chart_file)
    return Chart.model_validate(chart_data)
