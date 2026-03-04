import asyncio
import json
from contextlib import suppress

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from rythm_jump.engine.session import GameSession, Mode

router = APIRouter()
MAX_SESSIONS: int = 100
_sessions: dict[str, GameSession] = {}
_session_connection_counts: dict[str, int] = {}


class SessionCapacityError(Exception):
    pass


def __test_reset_sessions() -> None:
    _sessions.clear()
    _session_connection_counts.clear()


def _get_or_create_session(session_id: str) -> GameSession:
    existing_session = _sessions.get(session_id)
    if existing_session is not None:
        return existing_session

    if len(_sessions) >= MAX_SESSIONS:
        eviction_target: str | None = None
        for candidate_session_id in _sessions:
            if _session_connection_counts.get(candidate_session_id, 0) == 0:
                eviction_target = candidate_session_id
                break
        if eviction_target is None:
            raise SessionCapacityError
        _sessions.pop(eviction_target)

    new_session = GameSession(mode=Mode.BROWSER_ATTACHED)
    _sessions[session_id] = new_session
    return new_session


@router.websocket("/ws/session/{session_id}")
async def session_stream(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        session = _get_or_create_session(session_id)
    except SessionCapacityError:
        await websocket.send_json({"type": "error", "reason": "session_capacity"})
        await websocket.close()
        return

    clock_task: asyncio.Task[None] | None = None
    _session_connection_counts[session_id] = (
        _session_connection_counts.get(session_id, 0) + 1
    )

    try:
        session.start()
        await websocket.send_json(
            {"type": "session_state", "session_id": session_id, "state": session.state}
        )

        async def send_clock_ticks() -> None:
            tick = 0
            while True:
                await asyncio.sleep(0.1)
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

            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "session_id": session_id})
            elif message.get("type") == "simulate_events":
                await websocket.send_json(
                    {"type": "lane_event", "session_id": session_id, "lane": "left"}
                )
                await websocket.send_json(
                    {"type": "judgement", "session_id": session_id, "result": "perfect"}
                )
            else:
                await websocket.send_json({"type": "error", "reason": "unknown_type"})
    except WebSocketDisconnect:
        pass
    finally:
        current_count = _session_connection_counts.get(session_id, 0)
        next_count = current_count - 1
        if next_count <= 0:
            _session_connection_counts.pop(session_id, None)
            session.on_browser_disconnected()
        else:
            _session_connection_counts[session_id] = next_count

        if clock_task is not None:
            clock_task.cancel()
            with suppress(asyncio.CancelledError, RuntimeError, WebSocketDisconnect):
                await clock_task
