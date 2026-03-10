"""WebSocket session streaming and runtime control."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, cast

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from rythm_jump.audio_analysis import resolve_playback_duration_ms
from rythm_jump.engine.runtime import EventPayload, EventSink, GameRuntime
from rythm_jump.song_library import (
    audio_file_path,
    chart_path,
    charts_root_dir,
    load_chart,
)

if TYPE_CHECKING:
    from pathlib import Path

    from rythm_jump.engine.types import Lane
    from rythm_jump.models.chart import Chart

router = APIRouter()


def _charts_root_dir() -> Path:
    return charts_root_dir()


class WebSocketSessionSink(EventSink):
    """Forward runtime events to a websocket client."""

    def __init__(self, websocket: WebSocket, session_id: str) -> None:
        """Bind a websocket connection to a runtime session stream."""
        self._websocket = websocket
        self._session_id = session_id

    async def publish(self, event: EventPayload) -> None:
        """Send one runtime event to the websocket client."""
        payload = dict(event)
        payload["session_id"] = self._session_id
        await self._websocket.send_json(payload)


def load_session_song(song_id: str) -> tuple[Chart, Path, int]:
    """Load the chart, audio path, and duration needed to start a session."""
    current_chart_path = chart_path(song_id, root_dir=_charts_root_dir())
    if not current_chart_path.exists():
        message = "missing_chart"
        raise FileNotFoundError(message)

    current_audio_path = audio_file_path(song_id, root_dir=_charts_root_dir())
    if current_audio_path is None:
        message = "missing_audio"
        raise FileNotFoundError(message)

    chart = load_chart(current_chart_path)
    duration_ms = resolve_playback_duration_ms(chart, current_audio_path)
    return chart, current_audio_path, duration_ms


async def _handle_start_session(
    message: dict[str, object],
    runtime: GameRuntime,
) -> None:
    """Handle the start session payload and play back the requested chart."""
    song_id = message.get("song_id")
    if not isinstance(song_id, str) or not song_id:
        return

    try:
        chart, audio_path, duration_ms = load_session_song(song_id)
    except (FileNotFoundError, json.JSONDecodeError, ValidationError, OSError):
        return

    await runtime.start(
        song_id=song_id,
        chart=chart,
        duration_ms=duration_ms,
        audio_path=audio_path,
    )


async def _handle_lane_event(
    message: dict[str, object],
    runtime: GameRuntime,
) -> None:
    lane = message.get("lane")
    if lane not in ("left", "right"):
        return
    lane_name = cast("Lane", lane)
    source = message.get("source")
    source_name = source if isinstance(source, str) and source else "web"
    await runtime.submit_lane_input(lane_name, source=source_name)


async def _dispatch_session_message(
    message: dict[str, object],
    websocket: WebSocket,
    runtime: GameRuntime,
    session_id: str,
) -> bool:
    """Dispatch one decoded session message and report whether it was handled."""
    msg_type = message.get("type")
    handled = True

    if msg_type == "ping":
        await websocket.send_json({"type": "pong", "session_id": session_id})
    elif msg_type == "lane_event":
        await _handle_lane_event(message, runtime)
    elif msg_type == "start_session":
        await _handle_start_session(message, runtime)
    elif msg_type == "stop_session":
        await runtime.stop()
    elif msg_type == "pause_session":
        await runtime.pause()
    elif msg_type == "resume_session":
        await runtime.resume()
    else:
        handled = False

    return handled


async def _process_session_messages(
    websocket: WebSocket,
    session_id: str,
    runtime: GameRuntime,
) -> None:
    """Process WebSocket payloads and dispatch commands."""
    while True:
        raw_message = await websocket.receive_text()
        try:
            message = json.loads(raw_message)
        except json.JSONDecodeError:
            await websocket.send_json({"type": "error", "reason": "invalid_json"})
            continue

        if not isinstance(message, dict):
            await websocket.send_json({"type": "error", "reason": "invalid_payload"})
            continue

        if await _dispatch_session_message(message, websocket, runtime, session_id):
            continue

        await websocket.send_json({"type": "error", "reason": "unknown_type"})


@router.websocket("/ws/session/{session_id}")
async def session_stream(websocket: WebSocket, session_id: str) -> None:
    """Stream events for the WebSocket-connected session."""
    await websocket.accept()
    runtime = getattr(websocket.app.state, "runtime", None)
    if not isinstance(runtime, GameRuntime):
        await websocket.send_json({"type": "error", "reason": "no_active_runtime"})
        await websocket.close()
        return

    sink = WebSocketSessionSink(websocket, session_id)

    try:
        await runtime.add_event_sink(sink)
        await _process_session_messages(websocket, session_id, runtime)
    except WebSocketDisconnect:
        pass
    finally:
        runtime.remove_event_sink(sink)
