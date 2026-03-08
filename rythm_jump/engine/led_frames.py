"""LED frame projection helpers for Rhythm Jump."""

import math
from typing import Literal

Side = Literal["left", "right"]

_VALID_SIDES = ("left", "right")
_MIN_STRIP_LEN = 2


def project_bar(strip_len: int, progress: float, side: Side) -> int:
    """Project progress along a strip onto the LED indexes for the requested side."""
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

    if side == "left":
        return round((half - 1) * (1.0 - clipped_progress))
    return half + round((half - 1) * clipped_progress)
