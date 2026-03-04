import asyncio
import os
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from rythm_jump.api.charts import router as charts_router
from rythm_jump.api.http import router as api_router
from rythm_jump.api.ws import router as ws_router
from rythm_jump.engine.session import GameSession, Mode
from rythm_jump.headless import run_headless_step
from rythm_jump.hw.gpio_input import read_contact_pressed

FRONTEND_DIR = Path(__file__).parent.parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.headless_task = None
    app.state.headless_session = None

    if is_headless_mode_enabled():
        session = GameSession(mode=Mode.HEADLESS)
        app.state.headless_session = session
        app.state.headless_task = asyncio.create_task(_headless_polling_worker(session))

    yield

    task = getattr(app.state, "headless_task", None)
    if task is not None:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task

    app.state.headless_task = None


app = FastAPI(title="Rhythm Jump Backend", lifespan=lifespan)
app.include_router(api_router, prefix="/api")
app.include_router(charts_router, prefix="/api")
app.include_router(ws_router)

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")


def is_headless_mode_enabled() -> bool:
    return os.getenv("RHYTHM_HEADLESS_MODE") == "1"


def run_headless_polling_step(
    session: GameSession, read_contact: Callable[[], bool] | None = None
) -> bool:
    contact_reader = read_contact or read_contact_pressed
    return run_headless_step(session=session, contact_pressed=bool(contact_reader()))


async def _headless_polling_worker(
    session: GameSession,
    read_contact: Callable[[], bool] | None = None,
    poll_interval_s: float = 0.05,
) -> None:
    while True:
        try:
            run_headless_polling_step(session=session, read_contact=read_contact)
        except Exception as error:
            print(f"headless poll error: {error}")
        await asyncio.sleep(poll_interval_s)
