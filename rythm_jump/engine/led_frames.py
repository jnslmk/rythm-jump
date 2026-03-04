import math
from typing import Literal


Side = Literal["left", "right"]


def project_bar(strip_len: int, progress: float, side: Side) -> int:
    if type(strip_len) is not int:
        raise TypeError("strip_len must be an int")
    if side not in ("left", "right"):
        raise ValueError("side must be 'left' or 'right'")
    if strip_len < 2:
        raise ValueError("strip_len must be >= 2")
    if strip_len % 2 != 0:
        raise ValueError("strip_len must be even")
    if not math.isfinite(progress):
        raise ValueError("progress must be finite")

    half = strip_len // 2
    clipped_progress = min(max(progress, 0.0), 1.0)

    if side == "left":
        return int(round((half - 1) * (1.0 - clipped_progress)))
    return half + int(round((half - 1) * clipped_progress))
