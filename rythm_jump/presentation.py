"""Presentation-oriented color constants shared by UI-adjacent modules."""

from __future__ import annotations

from typing import Final

DOMINANT_BAND_COLORS: Final[dict[str, str]] = {
    "low": "#60a5fa",
    "mid": "#2dd4bf",
    "high": "#f472b6",
}

LEFT_BAR_RGB: Final[tuple[int, int, int]] = (90, 210, 255)
RIGHT_BAR_RGB: Final[tuple[int, int, int]] = (255, 105, 160)
LEFT_PULSE_RGB: Final[tuple[int, int, int]] = (190, 245, 255)
RIGHT_PULSE_RGB: Final[tuple[int, int, int]] = (255, 210, 225)


def dominant_band_color(dominant_band: str) -> str:
    """Return the configured color hint for a dominant spectral band."""
    return DOMINANT_BAND_COLORS[dominant_band]
