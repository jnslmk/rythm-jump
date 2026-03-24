"""LED frame projection helpers for Rhythm Jump."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from rythm_jump.presentation import (
    LEFT_BAR_RGB,
    LEFT_PULSE_RGB,
    RIGHT_BAR_RGB,
    RIGHT_PULSE_RGB,
)

if TYPE_CHECKING:
    from rythm_jump.engine.types import Lane

Side = Literal["left", "right"]
RgbPixel = tuple[int, int, int]

_VALID_SIDES = ("left", "right")
_MIN_STRIP_LEN = 2
_BAR_SPAN = 4
_INPUT_PULSE_MS = 180
_LEFT_BAR_COLOR: RgbPixel = LEFT_BAR_RGB
_RIGHT_BAR_COLOR: RgbPixel = RIGHT_BAR_RGB
_LEFT_PULSE_COLOR: RgbPixel = LEFT_PULSE_RGB
_RIGHT_PULSE_COLOR: RgbPixel = RIGHT_PULSE_RGB


@dataclass(frozen=True, slots=True)
class InputPulse:
    """Represent a recent lane pulse to overlay near the center LEDs."""

    lane: Lane
    started_ms: int


@dataclass(frozen=True, slots=True)
class LedFrame:
    """Represent one complete LED frame."""

    progress_ms: int
    pixels: tuple[RgbPixel, ...]
    levels: tuple[float, float]

    def as_event_payload(self) -> dict[str, object]:
        """Convert the frame to a websocket-friendly payload."""
        return {
            "type": "led_frame",
            "progress_ms": self.progress_ms,
            "levels": list(self.levels),
            "pixels": [list(pixel) for pixel in self.pixels],
        }


def project_bar(strip_len: int, progress: float, side: Side) -> int:
    """Project progress to the leading edge index for the requested lane bar."""
    if type(strip_len) is not int:
        message = "strip_len must be an int"
        raise TypeError(message)
    if side not in _VALID_SIDES:
        message = "side must be 'left' or 'right'"
        raise ValueError(message)
    if strip_len < _MIN_STRIP_LEN:
        message = "strip_len must be >= 2"
        raise ValueError(message)
    if strip_len % 2 != 0:
        message = "strip_len must be even"
        raise ValueError(message)
    if not math.isfinite(progress):
        message = "progress must be finite"
        raise ValueError(message)

    half = strip_len // 2
    clipped_progress = min(max(progress, 0.0), 1.0)
    max_offset = max(half - _BAR_SPAN, 0)

    if side == "left":
        return round(max_offset * (1.0 - clipped_progress))
    return (strip_len - 1) - round(max_offset * (1.0 - clipped_progress))


def build_led_frame(  # noqa: PLR0913
    *,
    strip_len: int,
    travel_time_ms: int,
    progress_ms: int,
    left_hit_times: list[int],
    right_hit_times: list[int],
    input_pulses: list[InputPulse],
) -> LedFrame:
    """Build a full LED frame for the current playback progress."""
    pixels: list[list[int]] = [[0, 0, 0] for _ in range(strip_len)]

    _overlay_lane_bars(
        pixels,
        lane="left",
        hit_times=left_hit_times,
        progress_ms=progress_ms,
        travel_time_ms=travel_time_ms,
        color=_LEFT_BAR_COLOR,
    )
    _overlay_lane_bars(
        pixels,
        lane="right",
        hit_times=right_hit_times,
        progress_ms=progress_ms,
        travel_time_ms=travel_time_ms,
        color=_RIGHT_BAR_COLOR,
    )

    left_level = _overlay_input_pulses(
        pixels,
        lane="left",
        progress_ms=progress_ms,
        input_pulses=input_pulses,
        color=_LEFT_PULSE_COLOR,
    )
    right_level = _overlay_input_pulses(
        pixels,
        lane="right",
        progress_ms=progress_ms,
        input_pulses=input_pulses,
        color=_RIGHT_PULSE_COLOR,
    )

    return LedFrame(
        progress_ms=progress_ms,
        pixels=tuple((red, green, blue) for red, green, blue in pixels),
        levels=(left_level, right_level),
    )


def _overlay_lane_bars(  # noqa: PLR0913
    pixels: list[list[int]],
    *,
    lane: Lane,
    hit_times: list[int],
    progress_ms: int,
    travel_time_ms: int,
    color: RgbPixel,
) -> None:
    for hit_time_ms in hit_times:
        spawn_ms = max(hit_time_ms - travel_time_ms, 0)
        if progress_ms < spawn_ms or progress_ms >= hit_time_ms:
            continue

        ratio = (progress_ms - spawn_ms) / max(travel_time_ms, 1)
        center_index = project_bar(len(pixels), ratio, lane)
        _blend_span(pixels, center_index=center_index, lane=lane, color=color)


def _overlay_input_pulses(
    pixels: list[list[int]],
    *,
    lane: Lane,
    progress_ms: int,
    input_pulses: list[InputPulse],
    color: RgbPixel,
) -> float:
    active_level = 0.0
    for pulse in input_pulses:
        if pulse.lane != lane:
            continue
        age_ms = progress_ms - pulse.started_ms
        if age_ms < 0 or age_ms > _INPUT_PULSE_MS:
            continue
        intensity = 1.0 - (age_ms / _INPUT_PULSE_MS)
        active_level = max(active_level, intensity)
        _blend_center_pulse(pixels, lane=lane, intensity=intensity, color=color)
    return active_level


def _blend_span(
    pixels: list[list[int]],
    *,
    center_index: int,
    lane: Lane,
    color: RgbPixel,
) -> None:
    if lane == "left":
        start = max(center_index, 0)
        end = min(center_index + _BAR_SPAN - 1, len(pixels) - 1)
    else:
        end = min(center_index, len(pixels) - 1)
        start = max(end - _BAR_SPAN + 1, 0)

    for index in range(start, end + 1):
        _blend_pixel(pixels[index], color, intensity=1.0)


def _blend_center_pulse(
    pixels: list[list[int]],
    *,
    lane: Lane,
    intensity: float,
    color: RgbPixel,
) -> None:
    half = len(pixels) // 2
    indexes = range(half - 3, half) if lane == "left" else range(half, half + 3)
    for index in indexes:
        if 0 <= index < len(pixels):
            _blend_pixel(pixels[index], color, intensity=intensity)


def _blend_pixel(pixel: list[int], color: RgbPixel, *, intensity: float) -> None:
    for channel_index, channel_value in enumerate(color):
        blended_value = pixel[channel_index] + round(channel_value * intensity)
        pixel[channel_index] = min(blended_value, 255)
