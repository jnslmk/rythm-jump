from collections.abc import Sequence
from typing import Protocol


class LedOutput(Protocol):
    def write_frame(self, active_indices: Sequence[int]) -> None: ...


class NoOpLedOutput:
    def write_frame(self, active_indices: Sequence[int]) -> None:
        _ = active_indices


class SimLedOutput:
    def __init__(self) -> None:
        self.frames: list[list[int]] = []

    def write_frame(self, active_indices: Sequence[int]) -> None:
        self.frames.append(list(active_indices))
