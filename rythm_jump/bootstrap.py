"""Application wiring helpers for assembling the backend runtime stack."""

from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass
from typing import TYPE_CHECKING

from rythm_jump.engine.io import PollingInputSource, run_polling_input_worker
from rythm_jump.engine.runtime import GameRuntime
from rythm_jump.hw.audio_playback import AudioPlayer, PygameAudioPlayer
from rythm_jump.hw.gpio_input import read_jump_box_states
from rythm_jump.hw.led_output import Ws2811LedOutput

if TYPE_CHECKING:
    from fastapi import FastAPI


@dataclass(slots=True)
class RuntimeStack:
    """Own the long-lived runtime objects that are attached to the app."""

    runtime: GameRuntime
    input_source: PollingInputSource
    polling_task: asyncio.Task[None] | None = None


def build_runtime_stack(
    *,
    audio_player: AudioPlayer | None = None,
) -> RuntimeStack:
    """Construct the default runtime, GPIO input source, and LED output wiring."""
    runtime = GameRuntime(audio_player=audio_player or PygameAudioPlayer())
    runtime.set_led_output("physical", Ws2811LedOutput())
    input_source = PollingInputSource(
        runtime,
        name="jump_box",
        read_states=read_jump_box_states,
    )
    return RuntimeStack(runtime=runtime, input_source=input_source)


def attach_runtime_stack(app: FastAPI, stack: RuntimeStack) -> None:
    """Expose the runtime stack on FastAPI app state for API routes and shutdown."""
    app.state.runtime = stack.runtime
    app.state.input_source = stack.input_source
    app.state.polling_task = stack.polling_task


def start_runtime_stack(stack: RuntimeStack) -> None:
    """Start the background GPIO polling task for the runtime stack."""
    stack.polling_task = asyncio.create_task(
        run_polling_input_worker(stack.input_source),
    )


async def stop_runtime_stack(stack: RuntimeStack) -> None:
    """Cancel background tasks and close the runtime cleanly."""
    task = stack.polling_task
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    await stack.runtime.close()
    stack.polling_task = None
