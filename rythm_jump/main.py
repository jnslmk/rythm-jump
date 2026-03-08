import asyncio
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from rythm_jump.api.charts import router as charts_router
from rythm_jump.api.http import router as api_router
from rythm_jump.api.ws import router as ws_router
from rythm_jump.engine.session import GameSession
from rythm_jump.headless import run_headless_step
from rythm_jump.hw.gpio_input import read_contact_pressed

FRONTEND_DIR = Path(__file__).parent.parent / "web"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Always have one global session
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


# Headless polling loop is always enabled to allow hardware inputs to trigger the session.


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
