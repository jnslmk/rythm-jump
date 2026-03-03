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
            message = await websocket.receive_json()
            if message.get('type') == 'ping':
                await websocket.send_json({'type': 'pong', 'session_id': session_id})
            else:
                await websocket.send_json(
                    {
                        'type': 'session_state',
                        'session_id': session_id,
                        'state': 'idle',
                    }
                )
    except WebSocketDisconnect:
        return
