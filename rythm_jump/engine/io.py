"""Input abstractions for physical and remote controls."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from collections.abc import Callable

    from rythm_jump.engine.types import Lane


class RuntimeInputTarget(Protocol):
    """Protocol for runtime-like objects that accept lane input."""

    async def submit_lane_input(self, lane: Lane, *, source: str) -> None:
        """Submit one lane input event."""


class PollingInputSource:
    """Poll lane states and submit rising edges to the runtime."""

    def __init__(
        self,
        runtime: RuntimeInputTarget,
        *,
        name: str,
        read_states: Callable[[], dict[Lane, bool]],
    ) -> None:
        """Store the runtime target and state reader for polling."""
        self._runtime = runtime
        self._name = name
        self._read_states = read_states
        self._last_states: dict[Lane, bool] = {"left": False, "right": False}

    async def poll_once(self) -> bool:
        """Read the current lane state map and dispatch new presses."""
        states = self._read_states()
        triggered = False
        for lane in ("left", "right"):
            current = bool(states.get(lane, False))
            previous = self._last_states[lane]
            if current and not previous:
                await self._runtime.submit_lane_input(lane, source=self._name)
                triggered = True
            self._last_states[lane] = current
        return triggered


async def run_polling_input_worker(
    source: PollingInputSource,
    *,
    poll_interval_s: float = 0.01,
) -> None:
    """Poll an input source forever."""
    while True:
        with suppress(RuntimeError, ValueError):
            await source.poll_once()
        await asyncio.sleep(poll_interval_s)
