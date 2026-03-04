import asyncio
import json
from contextlib import suppress
from pathlib import Path
from typing import TypedDict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from rythm_jump.api.charts import _charts_root_dir
from rythm_jump.engine.chart_loader import load_chart
from rythm_jump.engine.session import State
from rythm_jump.models.chart import Chart

router = APIRouter()

TICK_INTERVAL_S = 0.1
DECAY_FACTOR = 0.85


def _find_audio_path(song_id: str) -> Path | None:
    song_dir = _charts_root_dir() / song_id
    if not song_dir.is_dir():
        return None
    for candidate in sorted(song_dir.glob("audio.*")):
        if candidate.is_file():
            return candidate
    return None


def _chart_duration_ms(chart: Chart) -> int:
    max_hit = 0
    if chart.left:
        max_hit = max(max_hit, max(chart.left))
    if chart.right:
        max_hit = max(max_hit, max(chart.right))
    return max_hit + chart.travel_time_ms


class _ActiveBar(TypedDict):
    lane: str
    hit_time_ms: int
    spawn_ms: int


@router.websocket("/ws/session/{session_id}")
async def session_stream(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    session = getattr(websocket.app.state, "session", None)
    if session is None:
        await websocket.send_json({"type": "error", "reason": "no_active_session"})
        await websocket.close()
        return

    clock_task: asyncio.Task[None] | None = None
    playback_task: asyncio.Task[None] | None = None

    async def start_playback(chart: Chart) -> None:
        nonlocal playback_task

        async def playback_loop() -> None:
            left_idx = 0
            right_idx = 0
            left_level = 0.0
            right_level = 0.0
            progress_ms = 0
            travel_time_ms = chart.travel_time_ms
            duration = _chart_duration_ms(chart)
            left_spawn_idx = 0
            right_spawn_idx = 0
            active_bars: list[_ActiveBar] = []

            def spawn_ready_bars(
                hit_times: list[int], lane: str, current_index: int
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
                        }
                    )
                    current_index += 1
                return current_index

            try:
                while progress_ms <= duration and session.state == State.PLAYING:
                    left_spawn_idx = spawn_ready_bars(
                        chart.left, "left", left_spawn_idx
                    )
                    right_spawn_idx = spawn_ready_bars(
                        chart.right, "right", right_spawn_idx
                    )
                    while (
                        left_idx < len(chart.left)
                        and progress_ms >= chart.left[left_idx]
                    ):
                        left_level = 1.0
                        await websocket.send_json(
                            {
                                "type": "lane_event",
                                "session_id": session_id,
                                "lane": "left",
                            }
                        )
                        session.handle_input("left")
                        left_idx += 1

                    while (
                        right_idx < len(chart.right)
                        and progress_ms >= chart.right[right_idx]
                    ):
                        right_level = 1.0
                        await websocket.send_json(
                            {
                                "type": "lane_event",
                                "session_id": session_id,
                                "lane": "right",
                            }
                        )
                        session.handle_input("right")
                        right_idx += 1

                    await websocket.send_json(
                        {
                            "type": "led_frame",
                            "session_id": session_id,
                            "progress_ms": progress_ms,
                            "levels": [left_level, right_level],
                        }
                    )

                    remaining_ms = max(duration - progress_ms, 0)
                    next_active_bars: list[_ActiveBar] = []
                    for bar in active_bars:
                        progress_since_spawn = progress_ms - bar["spawn_ms"]
                        if progress_since_spawn < 0:
                            next_active_bars.append(bar)
                            continue

                        bar_progress = min(progress_since_spawn, travel_time_ms)
                        await websocket.send_json(
                            {
                                "type": "bar_frame",
                                "session_id": session_id,
                                "lane": bar["lane"],
                                "hit_time_ms": bar["hit_time_ms"],
                                "travel_time_ms": travel_time_ms,
                                "progress_ms": bar_progress,
                                "remaining_ms": remaining_ms,
                            }
                        )

                        if progress_since_spawn < travel_time_ms:
                            next_active_bars.append(bar)

                    active_bars = next_active_bars

                    await asyncio.sleep(TICK_INTERVAL_S)
                    progress_ms += int(TICK_INTERVAL_S * 1000)
                    left_level = max(left_level * DECAY_FACTOR, 0.0)
                    right_level = max(right_level * DECAY_FACTOR, 0.0)
            except asyncio.CancelledError:  # pragma: no cover - cleanup only
                raise
            finally:
                session.state = State.IDLE
                await websocket.send_json(
                    {
                        "type": "session_state",
                        "session_id": session_id,
                        "state": session.state,
                    }
                )

        if playback_task is not None:
            playback_task.cancel()
            with suppress(asyncio.CancelledError):
                await playback_task

        if session.state != State.IDLE:
            return

        session.start()
        await websocket.send_json(
            {
                "type": "session_state",
                "session_id": session_id,
                "state": session.state,
            }
        )
        playback_task = asyncio.create_task(playback_loop())

    try:
        await websocket.send_json(
            {"type": "session_state", "session_id": session_id, "state": session.state}
        )

        async def send_clock_ticks() -> None:
            tick = 0
            while True:
                await asyncio.sleep(TICK_INTERVAL_S)
                await websocket.send_json(
                    {"type": "clock_tick", "session_id": session_id, "tick": tick}
                )
                tick += 1

        clock_task = asyncio.create_task(send_clock_ticks())

        while True:
            raw_message = await websocket.receive_text()
            try:
                message = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "reason": "invalid_json"})
                continue

            if not isinstance(message, dict):
                await websocket.send_json(
                    {"type": "error", "reason": "invalid_payload"}
                )
                continue

            msg_type = message.get("type")
            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "session_id": session_id})
            elif msg_type == "lane_event":
                lane = message.get("lane")
                if lane in ("left", "right"):
                    await websocket.send_json(
                        {"type": "lane_event", "session_id": session_id, "lane": lane}
                    )
                    session.handle_input(lane)
            elif msg_type == "start_session":
                if session.state == State.PLAYING:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "reason": "session_already_playing",
                        }
                    )
                    continue

                song_id = message.get("song_id")
                if not song_id:
                    await websocket.send_json(
                        {"type": "error", "reason": "missing_song_id"}
                    )
                    continue

                chart_path = _charts_root_dir() / song_id / "chart.json"
                if not chart_path.exists():
                    await websocket.send_json(
                        {"type": "error", "reason": "chart_not_found"}
                    )
                    continue

                audio_path = _find_audio_path(song_id)
                if audio_path is None:
                    await websocket.send_json(
                        {"type": "error", "reason": "audio_not_found"}
                    )
                    continue

                try:
                    chart = load_chart(chart_path)
                except Exception:
                    await websocket.send_json(
                        {"type": "error", "reason": "chart_load_failed"}
                    )
                    continue

                await start_playback(chart)
            elif msg_type == "stop_session":
                session.state = State.IDLE
                if playback_task is not None:
                    playback_task.cancel()
                    with suppress(asyncio.CancelledError):
                        await playback_task
                    playback_task = None
                await websocket.send_json(
                    {
                        "type": "session_state",
                        "session_id": session_id,
                        "state": session.state,
                    }
                )
            else:
                await websocket.send_json({"type": "error", "reason": "unknown_type"})
    except WebSocketDisconnect:
        pass
    finally:
        if clock_task is not None:
            clock_task.cancel()
            with suppress(asyncio.CancelledError, RuntimeError, WebSocketDisconnect):
                await clock_task
        if playback_task is not None:
            playback_task.cancel()
            with suppress(asyncio.CancelledError, RuntimeError, WebSocketDisconnect):
                await playback_task
