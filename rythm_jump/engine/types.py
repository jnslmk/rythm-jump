"""Shared engine types used across runtime and adapters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Lane = Literal["left", "right"]


@dataclass(slots=True)
class LaneInputEvent:
    """Represent a single lane press delivered to the engine."""

    lane: Lane
    source: str
    progress_ms: int
