"""Headless helpers that wire physical inputs into the runtime."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rythm_jump.engine.io import PollingInputSource


async def run_headless_step(source: PollingInputSource) -> bool:
    """Process one polling iteration from a physical input source."""
    return await source.poll_once()
