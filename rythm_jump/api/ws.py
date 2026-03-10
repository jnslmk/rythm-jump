"""WebSocket session streaming and lane event delivery for Rhythm Jump."""

from __future__ import annotations

import importlib
import json
import warnings
from typing import TYPE_CHECKING, cast

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from rythm_jump.api.charts import _charts_root_dir
from rythm_jump.engine.runtime import (
    EventPayload,
    EventSink,
    GameRuntime,
    load_runtime_chart,
)

if TYPE_CHECKING:
    from pathlib import Path

    from rythm_jump.engine.types import Lane
    from rythm_jump.models.chart import Chart

router = APIRouter()

DECAY_FACTOR = 0.85
_DECAY_REFERENCE_MS = 100.0


def _progress_ms_for_elapsed_s(
    started_at_s: float,
    now_s: float,
    paused_duration_s: float,
    duration_ms: int,
) -> int:
    """Convert monotonic elapsed time into clamped playback progress."""
    effective_elapsed_s = max(now_s - started_at_s - paused_duration_s, 0.0)
    return min(round(effective_elapsed_s * 1000), duration_ms)


def _decay_multiplier_for_delta_ms(delta_ms: int) -> float:
    """Scale the legacy 100 ms decay factor to arbitrary update intervals."""
    if delta_ms <= 0:
        return 1.0
    return DECAY_FACTOR ** (delta_ms / _DECAY_REFERENCE_MS)


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


def _find_audio_path(song_id: str) -> Path | None:
    song_dir = _charts_root_dir() / song_id
    if not song_dir.is_dir():
        return None
    for candidate in sorted(song_dir.glob("audio.*")):
        if candidate.is_file():
            return candidate
    return None


def _chart_duration_ms(chart: Chart) -> int:
    """Return the milliseconds span that the chart covers."""
    left_max = max(chart.left, default=0)
    right_max = max(chart.right, default=0)
    return max(left_max, right_max) + chart.travel_time_ms


def _analysis_duration_ms(chart: Chart) -> int:
    """Return the analyzed song duration when it is present."""
    analysis = chart.audio_analysis
    if analysis is None:
        return 0

    if analysis.duration_ms is not None:
        return int(analysis.duration_ms)

    beat_max = max(analysis.beat_times_ms, default=0)
    descriptor_max = max(
        (descriptor.time_ms for descriptor in analysis.beat_descriptors),
        default=0,
    )
    return max(beat_max, descriptor_max)


def _audio_duration_ms(audio_path: Path) -> int:
    """Return the duration of the audio file in milliseconds."""
    try:
        librosa = importlib.import_module("librosa")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", FutureWarning)
            warnings.simplefilter("ignore", DeprecationWarning)
            duration_s = float(librosa.get_duration(path=str(audio_path)))
    except (EOFError, ImportError, OSError, TypeError, ValueError):  # pragma: no cover
        return 0

    return max(round(duration_s * 1000), 0)


def resolve_playback_duration_ms(chart: Chart, audio_path: Path) -> int:
    """Resolve playback duration from audio first, then metadata fallbacks."""
    audio_duration_ms = _audio_duration_ms(audio_path)
    if audio_duration_ms > 0:
        return audio_duration_ms

    analysis_duration_ms = _analysis_duration_ms(chart)
    if analysis_duration_ms > 0:
        return analysis_duration_ms

    return _chart_duration_ms(chart)


async def _handle_start_session(
    message: dict[str, object],
    websocket: WebSocket,
    runtime: GameRuntime,
) -> None:
    """Handle the start session payload and play back the requested chart."""
    del websocket
    song_id = message.get("song_id")
    if not isinstance(song_id, str) or not song_id:
        return

    chart_path = _charts_root_dir() / song_id / "chart.json"
    if not chart_path.exists():
        return

    audio_path = _find_audio_path(song_id)
    if audio_path is None:
        return

    try:
        chart, duration_ms = load_runtime_chart(
            chart_path=chart_path,
            audio_path=audio_path,
            duration_resolver=resolve_playback_duration_ms,
        )
    except (json.JSONDecodeError, ValidationError, OSError):
        return

    await runtime.start(song_id=song_id, chart=chart, duration_ms=duration_ms)


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
        await _handle_start_session(message, websocket, runtime)
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
