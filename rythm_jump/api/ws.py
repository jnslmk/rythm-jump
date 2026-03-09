"""WebSocket session streaming and lane event delivery for Rhythm Jump."""

import asyncio
import importlib
import json
import warnings
from contextlib import suppress
from pathlib import Path
from typing import TypedDict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from rythm_jump.api.charts import _charts_root_dir
from rythm_jump.engine.chart_loader import load_chart
from rythm_jump.engine.session import GameSession, State
from rythm_jump.models.chart import Chart

router = APIRouter()

TICK_INTERVAL_S = 1 / 60
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


class _ActiveBar(TypedDict):
    lane: str
    hit_time_ms: int
    spawn_ms: int
    travel_time_ms: int


class _PlaybackController:
    """Manage playback tasks and keep the session state consistent."""

    def __init__(
        self,
        websocket: WebSocket,
        session: GameSession,
        session_id: str,
    ) -> None:
        self._websocket = websocket
        self._session = session
        self._session_id = session_id
        self._task: asyncio.Task[None] | None = None
        self._progress_ms = 0

    @property
    def session(self) -> GameSession:
        return self._session

    async def cancel(self) -> None:
        """Cancel the pending playback task, if any."""
        if self._task is None:
            return

        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        self._task = None

    async def start(self, chart: Chart, duration_ms: int) -> None:
        """Kick off a new playback run after stopping the previous one."""
        await self.cancel()
        if self._session.state != State.IDLE:
            return

        self._progress_ms = 0
        self._session.start()
        await self._websocket.send_json(
            {
                "type": "session_state",
                "session_id": self._session_id,
                "state": self._session.state,
            },
        )
        self._task = asyncio.create_task(self._run_playback(chart, duration_ms))

    async def _run_playback(self, chart: Chart, duration_ms: int) -> None:  # noqa: C901, PLR0915
        left_idx = 0
        right_idx = 0
        left_level = 0.0
        right_level = 0.0
        travel_time_ms = chart.travel_time_ms
        duration = duration_ms
        left_spawn_idx = 0
        right_spawn_idx = 0
        active_bars: list[_ActiveBar] = []
        loop = asyncio.get_running_loop()
        started_at_s = loop.time()
        paused_started_at_s: float | None = None
        paused_duration_s = 0.0
        previous_progress_ms = -1

        def spawn_ready_bars(
            hit_times: list[int],
            lane: str,
            current_index: int,
            progress_ms: int,
        ) -> int:
            while current_index < len(hit_times):
                hit_time_ms = hit_times[current_index]
                spawn_ms = max(hit_time_ms - travel_time_ms, 0)
                if progress_ms < spawn_ms:
                    break
                active_bars.append(
                    {
                        "lane": lane,
                        "hit_time_ms": hit_time_ms,
                        "spawn_ms": spawn_ms,
                        "travel_time_ms": travel_time_ms,
                    },
                )
                current_index += 1
            return current_index

        try:
            while self._session.state != State.IDLE:
                if self._session.state == State.PAUSED:
                    if paused_started_at_s is None:
                        paused_started_at_s = loop.time()
                    await asyncio.sleep(TICK_INTERVAL_S)
                    continue

                now_s = loop.time()
                if paused_started_at_s is not None:
                    paused_duration_s += now_s - paused_started_at_s
                    paused_started_at_s = None

                progress_ms = _progress_ms_for_elapsed_s(
                    started_at_s=started_at_s,
                    now_s=now_s,
                    paused_duration_s=paused_duration_s,
                    duration_ms=duration,
                )
                if progress_ms == previous_progress_ms:
                    await asyncio.sleep(TICK_INTERVAL_S)
                    continue

                progress_delta_ms = max(progress_ms - previous_progress_ms, 0)
                decay_multiplier = _decay_multiplier_for_delta_ms(progress_delta_ms)
                left_level = max(left_level * decay_multiplier, 0.0)
                right_level = max(right_level * decay_multiplier, 0.0)

                left_spawn_idx = spawn_ready_bars(
                    chart.left,
                    "left",
                    left_spawn_idx,
                    progress_ms,
                )
                right_spawn_idx = spawn_ready_bars(
                    chart.right,
                    "right",
                    right_spawn_idx,
                    progress_ms,
                )

                left_idx, left_level = await self._emit_lane_events(
                    chart.left,
                    "left",
                    progress_ms,
                    left_idx,
                    left_level,
                )
                right_idx, right_level = await self._emit_lane_events(
                    chart.right,
                    "right",
                    progress_ms,
                    right_idx,
                    right_level,
                )

                remaining_ms = max(duration - progress_ms, 0)
                active_bars = await self._dispatch_bar_frames(
                    active_bars,
                    progress_ms,
                    remaining_ms,
                )

                await self._send_led_frame(progress_ms, left_level, right_level)

                self._progress_ms = progress_ms
                previous_progress_ms = progress_ms
                if progress_ms >= duration:
                    break
                await asyncio.sleep(TICK_INTERVAL_S)
        finally:
            if self._session.state != State.PAUSED:
                self._session.state = State.IDLE
                self._progress_ms = 0
                await self._websocket.send_json(
                    {
                        "type": "session_state",
                        "session_id": self._session_id,
                        "state": self._session.state,
                    },
                )

    async def pause(self) -> None:
        """Pause the active playback loop without resetting progress."""
        if self._session.state != State.PLAYING:
            return
        self._session.pause()
        await self._websocket.send_json(
            {
                "type": "session_state",
                "session_id": self._session_id,
                "state": self._session.state,
                "progress_ms": self._progress_ms,
            },
        )

    async def resume(self) -> None:
        """Resume a paused playback loop."""
        if self._session.state != State.PAUSED:
            return
        self._session.resume()
        await self._websocket.send_json(
            {
                "type": "session_state",
                "session_id": self._session_id,
                "state": self._session.state,
                "progress_ms": self._progress_ms,
            },
        )

    async def _emit_lane_events(
        self,
        hits: list[int],
        lane: str,
        progress_ms: int,
        current_index: int,
        current_level: float,
    ) -> tuple[int, float]:
        while current_index < len(hits) and progress_ms >= hits[current_index]:
            current_level = 1.0
            await self._websocket.send_json(
                {
                    "type": "lane_event",
                    "session_id": self._session_id,
                    "lane": lane,
                },
            )
            self._session.handle_input(lane)
            current_index += 1
        return current_index, current_level

    async def _dispatch_bar_frames(
        self,
        active_bars: list[_ActiveBar],
        progress_ms: int,
        remaining_ms: int,
    ) -> list[_ActiveBar]:
        next_active_bars: list[_ActiveBar] = []
        for bar in active_bars:
            progress_since_spawn = progress_ms - bar["spawn_ms"]
            if progress_since_spawn < 0:
                next_active_bars.append(bar)
                continue

            bar_progress = min(progress_since_spawn, bar["travel_time_ms"])
            await self._websocket.send_json(
                {
                    "type": "bar_frame",
                    "session_id": self._session_id,
                    "lane": bar["lane"],
                    "hit_time_ms": bar["hit_time_ms"],
                    "travel_time_ms": bar["travel_time_ms"],
                    "progress_ms": bar_progress,
                    "remaining_ms": remaining_ms,
                },
            )

            if progress_since_spawn < bar["travel_time_ms"]:
                next_active_bars.append(bar)
        return next_active_bars

    async def _send_led_frame(
        self,
        progress_ms: int,
        left_level: float,
        right_level: float,
    ) -> None:
        await self._websocket.send_json(
            {
                "type": "led_frame",
                "session_id": self._session_id,
                "progress_ms": progress_ms,
                "levels": [left_level, right_level],
            },
        )


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


def _send_clock_ticks(websocket: WebSocket, session_id: str) -> asyncio.Task[None]:
    """Send periodic clock ticks for clients that request them."""

    async def clock_loop() -> None:
        tick = 0
        while True:
            await asyncio.sleep(TICK_INTERVAL_S)
            await websocket.send_json(
                {
                    "type": "clock_tick",
                    "session_id": session_id,
                    "tick": tick,
                },
            )
            tick += 1

    return asyncio.create_task(clock_loop())


async def _handle_start_session(
    message: dict[str, object],
    websocket: WebSocket,
    playback_controller: _PlaybackController,
) -> None:
    """Handle the start session payload and play back the requested chart."""
    song_id = message.get("song_id")
    if not isinstance(song_id, str) or not song_id:
        await websocket.send_json({"type": "error", "reason": "missing_song_id"})
        return

    chart_path = _charts_root_dir() / song_id / "chart.json"
    if not chart_path.exists():
        await websocket.send_json({"type": "error", "reason": "chart_not_found"})
        return

    audio_path = _find_audio_path(song_id)
    if audio_path is None:
        await websocket.send_json({"type": "error", "reason": "audio_not_found"})
        return

    try:
        chart = load_chart(chart_path)
    except (json.JSONDecodeError, ValidationError, OSError):
        await websocket.send_json({"type": "error", "reason": "chart_load_failed"})
        return

    await playback_controller.start(
        chart,
        resolve_playback_duration_ms(chart, audio_path),
    )


async def _handle_stop_session(
    websocket: WebSocket,
    session_id: str,
    playback_controller: _PlaybackController,
) -> None:
    """Reset and cancel playback when a stop message arrives."""
    playback_controller.session.state = State.IDLE
    await playback_controller.cancel()
    await websocket.send_json(
        {
            "type": "session_state",
            "session_id": session_id,
            "state": State.IDLE,
        },
    )


async def _handle_pause_session(
    playback_controller: _PlaybackController,
) -> None:
    """Pause playback without resetting its position."""
    await playback_controller.pause()


async def _handle_resume_session(
    playback_controller: _PlaybackController,
) -> None:
    """Resume playback from the paused position."""
    await playback_controller.resume()


async def _handle_lane_event(
    message: dict[str, object],
    websocket: WebSocket,
    session_id: str,
    playback_controller: _PlaybackController,
) -> None:
    """Forward a lane input to the connected session."""
    lane = message.get("lane")
    if lane not in ("left", "right"):
        return
    lane_name = str(lane)

    await websocket.send_json(
        {
            "type": "lane_event",
            "session_id": session_id,
            "lane": lane_name,
        },
    )
    playback_controller.session.handle_input(lane_name)


async def _dispatch_session_message(
    message: dict[str, object],
    websocket: WebSocket,
    session_id: str,
    playback_controller: _PlaybackController,
) -> bool:
    """Dispatch one decoded session message and report whether it was handled."""
    msg_type = message.get("type")
    handled = True

    if msg_type == "ping":
        await websocket.send_json({"type": "pong", "session_id": session_id})
    elif msg_type == "lane_event":
        await _handle_lane_event(
            message,
            websocket,
            session_id,
            playback_controller,
        )
    elif msg_type == "start_session":
        await _handle_start_session(message, websocket, playback_controller)
    elif msg_type == "stop_session":
        await _handle_stop_session(websocket, session_id, playback_controller)
    elif msg_type == "pause_session":
        await _handle_pause_session(playback_controller)
    elif msg_type == "resume_session":
        await _handle_resume_session(playback_controller)
    else:
        handled = False

    return handled


async def _process_session_messages(
    websocket: WebSocket,
    session_id: str,
    playback_controller: _PlaybackController,
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

        if await _dispatch_session_message(
            message,
            websocket,
            session_id,
            playback_controller,
        ):
            continue

        await websocket.send_json({"type": "error", "reason": "unknown_type"})


@router.websocket("/ws/session/{session_id}")
async def session_stream(websocket: WebSocket, session_id: str) -> None:
    """Stream events for the WebSocket-connected session."""
    await websocket.accept()
    session = getattr(websocket.app.state, "session", None)
    if not isinstance(session, GameSession):
        await websocket.send_json({"type": "error", "reason": "no_active_session"})
        await websocket.close()
        return

    playback_controller = _PlaybackController(websocket, session, session_id)
    clock_task: asyncio.Task[None] | None = None

    try:
        await websocket.send_json(
            {
                "type": "session_state",
                "session_id": session_id,
                "state": session.state,
            },
        )
        clock_task = _send_clock_ticks(websocket, session_id)
        await _process_session_messages(websocket, session_id, playback_controller)
    except WebSocketDisconnect:
        pass
    finally:
        if clock_task is not None:
            clock_task.cancel()
            with suppress(asyncio.CancelledError, RuntimeError, WebSocketDisconnect):
                await clock_task
        await playback_controller.cancel()
