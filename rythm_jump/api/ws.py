import asyncio
import json
from contextlib import suppress

from fastapi import APIRouter, WebSocket, WebSocketDisconnect


router = APIRouter()


@router.websocket("/ws/session/{session_id}")
async def session_stream(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    session = getattr(websocket.app.state, "session", None)
    if session is None:
        await websocket.send_json({"type": "error", "reason": "no_active_session"})
        await websocket.close()
        return

    clock_task: asyncio.Task[None] | None = None

    try:
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

            msg_type = message.get("type")
            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "session_id": session_id})
            elif msg_type == "lane_event":
                lane = message.get("lane")
                if lane in ("left", "right"):
                    # Broadcast lane event to ALL connected clients
                    # Actually, we should probably have a broadcast mechanism
                    # But for now, let's just pretend we processed it
                    await websocket.send_json(
                        {"type": "lane_event", "session_id": session_id, "lane": lane}
                    )
                    # Trigger physical logic if session is playing
                    session.handle_input(lane)
            elif msg_type == "start_session":
                # session.load_chart(message.get("song_id"))
                session.start()
                await websocket.send_json(
                    {
                        "type": "session_state",
                        "session_id": session_id,
                        "state": session.state,
                    }
                )
            elif msg_type == "stop_session":
                session.state = "idle"  # Rough implementation
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
