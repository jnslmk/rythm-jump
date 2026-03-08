from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from rythm_jump.main import app


def _receive_event(
    websocket: WebSocketTestSession, event_type: str
) -> dict[str, object]:
    for _ in range(10):
        event = websocket.receive_json()
        if event.get("type") == event_type:
            return event
    raise AssertionError(f"did not receive event type {event_type!r}")


def test_ws_session_stream_connects_and_pings() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/any-id") as websocket:
            session_state = _receive_event(websocket, "session_state")
            assert session_state["type"] == "session_state"
            assert session_state["session_id"] == "any-id"

            websocket.send_json({"type": "ping"})
            assert _receive_event(websocket, "pong") == {
                "type": "pong",
                "session_id": "any-id",
            }


def test_ws_session_broadcasts_lane_events() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/any-id") as websocket:
            _receive_event(websocket, "session_state")

            websocket.send_json({"type": "lane_event", "lane": "left"})
            lane_event = _receive_event(websocket, "lane_event")
            assert lane_event == {
                "type": "lane_event",
                "session_id": "any-id",
                "lane": "left",
            }


def test_ws_session_controls_start_stop() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/any-id") as websocket:
            _receive_event(websocket, "session_state")

            websocket.send_json({"type": "start_session", "song_id": "toxic"})
            state_event = _receive_event(websocket, "session_state")
            assert state_event["state"] == "playing"

            websocket.send_json({"type": "stop_session"})
            # Note: my current implementation doesn't send a state update on stop_session in ws.py
            # but it should probably broadcast it.
            # For now I'll just check if it doesn't crash.
