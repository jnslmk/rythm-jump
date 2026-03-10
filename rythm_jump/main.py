"""FastAPI application entrypoint for the Rhythm Jump backend."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from rythm_jump import compat  # ensure old stdlib APIs stay available
from rythm_jump.api.charts import router as charts_router
from rythm_jump.api.http import router as api_router
from rythm_jump.api.session_stream import router as session_stream_router
from rythm_jump.engine.io import PollingInputSource, run_polling_input_worker
from rythm_jump.engine.runtime import GameRuntime
from rythm_jump.hw.audio_playback import PygameAudioPlayer
from rythm_jump.hw.gpio_input import read_jump_box_states
from rythm_jump.hw.led_output import Ws2811LedOutput

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

del compat

FRONTEND_DIR = Path(__file__).parent.parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Keep a single shared runtime alive for the FastAPI app."""
    runtime = GameRuntime(audio_player=PygameAudioPlayer())
    runtime.set_led_output("physical", Ws2811LedOutput())
    app.state.runtime = runtime
    input_source = PollingInputSource(
        runtime,
        name="jump_box",
        read_states=read_jump_box_states,
    )
    app.state.input_source = input_source
    app.state.polling_task = asyncio.create_task(run_polling_input_worker(input_source))

    yield

    task = getattr(app.state, "polling_task", None)
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    await runtime.close()
    app.state.polling_task = None
    app.state.input_source = None
    app.state.runtime = None


app = FastAPI(title="Rhythm Jump Backend", lifespan=lifespan)
app.include_router(api_router, prefix="/api")
app.include_router(charts_router, prefix="/api")
app.include_router(session_stream_router)

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
