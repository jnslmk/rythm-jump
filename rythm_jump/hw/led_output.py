"""LED output abstractions used in Rhythm Jump."""

from collections.abc import Sequence
from typing import Protocol


class LedOutput(Protocol):
    """Protocol for objects that render LED frames."""

    def write_frame(self, active_indices: Sequence[int]) -> None:
        """Render the provided set of active LED indexes."""


class NoOpLedOutput:
    """LED output that discards every frame."""

    def write_frame(self, active_indices: Sequence[int]) -> None:
        """Drop the frame without acting on it."""
        _ = active_indices


class SimLedOutput:
    """In-memory LED output useful for tests."""

    def __init__(self) -> None:
        """Track frames as lists of active indices."""
        self.frames: list[list[int]] = []

    def write_frame(self, active_indices: Sequence[int]) -> None:
        """Store the current frame for later assertions."""
        self.frames.append(list(active_indices))
