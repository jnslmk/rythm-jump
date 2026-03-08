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
from rythm_jump.engine.session import GameSession
from rythm_jump.headless import run_headless_step
from rythm_jump.hw.gpio_input import read_contact_pressed

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable


del compat

FRONTEND_DIR = Path(__file__).parent.parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Keep a single shared session alive for the FastAPI app."""
    session = GameSession()
    app.state.session = session
    app.state.polling_task = asyncio.create_task(_headless_polling_worker(session))

    yield

    task = getattr(app.state, "polling_task", None)
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    app.state.polling_task = None
    app.state.session = None


app = FastAPI(title="Rhythm Jump Backend", lifespan=lifespan)
app.include_router(api_router, prefix="/api")
app.include_router(charts_router, prefix="/api")
app.include_router(ws_router)

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")


# Headless polling loop keeps hardware inputs tied to the session.


def run_headless_polling_step(
    session: GameSession,
    read_contact: Callable[[], bool] | None = None,
) -> bool:
    """Run a single headless iteration, optionally using a custom reader."""
    contact_reader = read_contact or read_contact_pressed
    return run_headless_step(session=session, contact_pressed=bool(contact_reader()))


async def _headless_polling_worker(
    session: GameSession,
    read_contact: Callable[[], bool] | None = None,
    poll_interval_s: float = 0.05,
) -> None:
    """Poll for contact events and drive the shared session continually."""
    while True:
        try:
            run_headless_polling_step(session=session, read_contact=read_contact)
        except (RuntimeError, ValueError):
            logger.exception("headless poll error")
        await asyncio.sleep(poll_interval_s)
