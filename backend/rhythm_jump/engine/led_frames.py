from typing import Literal


Side = Literal['left', 'right']


def project_bar(strip_len: int, progress: float, side: Side) -> int:
    half = strip_len // 2
    clipped_progress = min(max(progress, 0.0), 1.0)

    if side == 'left':
        return int(round((half - 1) * (1.0 - clipped_progress)))
    return half + int(round((half - 1) * clipped_progress))
