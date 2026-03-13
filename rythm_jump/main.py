"""FastAPI application entrypoint for the Rhythm Jump backend."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from rythm_jump import compat  # ensure old stdlib APIs stay available
from rythm_jump.api.charts import router as charts_router
from rythm_jump.api.http import router as api_router
from rythm_jump.api.session_stream import router as session_stream_router
from rythm_jump.bootstrap import (
    attach_runtime_stack,
    build_runtime_stack,
    start_runtime_stack,
    stop_runtime_stack,
)
from rythm_jump.config import build_path_config

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

del compat

FRONTEND_DIR = build_path_config().frontend_dir


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Keep a single shared runtime alive for the FastAPI app."""
    stack = build_runtime_stack()
    start_runtime_stack(stack)
    attach_runtime_stack(app, stack)

    yield

    await stop_runtime_stack(stack)
    app.state.polling_task = None
    app.state.input_source = None
    app.state.runtime = None


app = FastAPI(title="Rhythm Jump Backend", lifespan=lifespan)
app.include_router(api_router, prefix="/api")
app.include_router(charts_router, prefix="/api")
app.include_router(session_stream_router)

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
