"""FastAPI application entrypoint for the Rhythm Jump backend."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from rythm_jump import compat  # ensure old stdlib APIs stay available
from rythm_jump.api.charts import router as charts_router
from rythm_jump.api.http import router as api_router
from rythm_jump.api.ws import router as ws_router
from rythm_jump.engine.io import PollingInputSource
from rythm_jump.engine.runtime import GameRuntime
from rythm_jump.headless import run_headless_step
from rythm_jump.hw.gpio_input import read_jump_box_states
from rythm_jump.hw.led_output import Ws2811LedOutput

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

del compat

FRONTEND_DIR = Path(__file__).parent.parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Keep a single shared runtime alive for the FastAPI app."""
    runtime = GameRuntime()
    runtime.set_led_output("physical", Ws2811LedOutput())
    app.state.runtime = runtime
    input_source = PollingInputSource(
        runtime,
        name="jump_box",
        read_states=read_jump_box_states,
    )
    app.state.input_source = input_source
    app.state.polling_task = asyncio.create_task(
        _headless_polling_worker(input_source),
    )

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
app.include_router(ws_router)

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")


async def run_headless_polling_step(
    source: PollingInputSource,
) -> bool:
    """Run a single headless iteration for the configured input source."""
    return await run_headless_step(source)


async def _headless_polling_worker(
    source: PollingInputSource,
    poll_interval_s: float = 0.01,
) -> None:
    """Poll for contact events and drive the shared runtime continually."""
    while True:
        try:
            await source.poll_once()
        except (RuntimeError, ValueError):
            logger.exception("headless poll error")
        await asyncio.sleep(poll_interval_s)
