import asyncio
import json
from contextlib import suppress

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from rhythm_jump.engine.session import GameSession, Mode

router = APIRouter()
_sessions: dict[str, GameSession] = {}


@router.websocket('/ws/session/{session_id}')
async def session_stream(websocket: WebSocket, session_id: str) -> None:
    session = _sessions.setdefault(session_id, GameSession(mode=Mode.BROWSER_ATTACHED))
    session.start()

    await websocket.accept()
    await websocket.send_json(
        {'type': 'session_state', 'session_id': session_id, 'state': session.state}
    )

    async def send_clock_ticks() -> None:
        tick = 0
        while True:
            await asyncio.sleep(0.1)
            await websocket.send_json(
                {'type': 'clock_tick', 'session_id': session_id, 'tick': tick}
            )
            tick += 1

    clock_task = asyncio.create_task(send_clock_ticks())

    try:
        while True:
            raw_message = await websocket.receive_text()
            try:
                message = json.loads(raw_message)
            except json.JSONDecodeError:
                await websocket.send_json({'type': 'error', 'reason': 'invalid_json'})
                continue

            if not isinstance(message, dict):
                await websocket.send_json({'type': 'error', 'reason': 'invalid_payload'})
                continue

            if message.get('type') == 'ping':
                await websocket.send_json({'type': 'pong', 'session_id': session_id})
            elif message.get('type') == 'simulate_events':
                await websocket.send_json(
                    {'type': 'lane_event', 'session_id': session_id, 'lane': 'left'}
                )
                await websocket.send_json(
                    {'type': 'judgement', 'session_id': session_id, 'result': 'perfect'}
                )
            else:
                await websocket.send_json({'type': 'error', 'reason': 'unknown_type'})
    except WebSocketDisconnect:
        session.on_browser_disconnected()
    finally:
        clock_task.cancel()
        with suppress(asyncio.CancelledError):
            await clock_task
