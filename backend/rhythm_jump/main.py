import asyncio
import os
from collections.abc import Callable
from contextlib import suppress

from fastapi import FastAPI

from rhythm_jump.api.charts import router as charts_router
from rhythm_jump.api.http import router as api_router
from rhythm_jump.api.ws import router as ws_router
from rhythm_jump.engine.session import GameSession, Mode
from rhythm_jump.headless import run_headless_step

app = FastAPI(title='Rhythm Jump Backend')
app.include_router(api_router, prefix='/api')
app.include_router(charts_router, prefix='/api')
app.include_router(ws_router)


def is_headless_mode_enabled() -> bool:
    return os.getenv('RHYTHM_HEADLESS_MODE') == '1'


def read_contact_pressed() -> bool:
    # Hardware integration is intentionally minimal for now.
    return False


def run_headless_polling_step(
    session: GameSession, read_contact: Callable[[], bool] = read_contact_pressed
) -> bool:
    return run_headless_step(session=session, contact_pressed=bool(read_contact()))


async def _headless_polling_worker(
    session: GameSession,
    read_contact: Callable[[], bool] = read_contact_pressed,
    poll_interval_s: float = 0.05,
) -> None:
    while True:
        run_headless_polling_step(session=session, read_contact=read_contact)
        await asyncio.sleep(poll_interval_s)


@app.on_event('startup')
async def _startup_headless_runtime() -> None:
    app.state.headless_task = None
    app.state.headless_session = None

    if not is_headless_mode_enabled():
        return

    session = GameSession(mode=Mode.HEADLESS)
    app.state.headless_session = session
    app.state.headless_task = asyncio.create_task(_headless_polling_worker(session))


@app.on_event('shutdown')
async def _shutdown_headless_runtime() -> None:
    task = getattr(app.state, 'headless_task', None)
    if task is None:
        return

    task.cancel()
    with suppress(asyncio.CancelledError):
        await task

    app.state.headless_task = None
