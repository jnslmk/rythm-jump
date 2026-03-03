import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket('/ws/session/{session_id}')
async def session_stream(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    await websocket.send_json(
        {'type': 'session_snapshot', 'session_id': session_id, 'state': 'idle'}
    )

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
            else:
                await websocket.send_json({'type': 'error', 'reason': 'unknown_type'})
    except WebSocketDisconnect:
        return
