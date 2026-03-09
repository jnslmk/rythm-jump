"""WebSocket integration tests for Rhythm Jump."""

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from rythm_jump.main import app


def _receive_event(
    websocket: WebSocketTestSession,
    event_type: str,
) -> dict[str, object]:
    """Wait for the requested event type and return it."""
    for _ in range(100):
        event = websocket.receive_json()
        if event.get("type") == event_type:
            return event
    message = f"did not receive event type {event_type!r}"
    raise AssertionError(message)


def test_ws_session_stream_connects_and_pings() -> None:
    """Verify the session stream can connect and acknowledge pings."""
    with (
        TestClient(app) as client,
        client.websocket_connect(
            "/ws/session/any-id",
        ) as websocket,
    ):
        session_state = _receive_event(websocket, "session_state")
        if session_state["type"] != "session_state":
            pytest.fail(
                "initial session_state payload did not advertise "
                "'session_state' as type",
            )
        if session_state["session_id"] != "any-id":
            pytest.fail(
                "session_id mismatch in the initial session_state payload",
            )

        websocket.send_json({"type": "ping"})
        pong = _receive_event(websocket, "pong")
        expected_pong = {"type": "pong", "session_id": "any-id"}
        if pong != expected_pong:
            pytest.fail(
                f"unexpected pong payload: {pong!r} != {expected_pong!r}",
            )


def test_ws_session_broadcasts_lane_events() -> None:
    """Ensure lane events are broadcast back to the WebSocket client."""
    with (
        TestClient(app) as client,
        client.websocket_connect(
            "/ws/session/any-id",
        ) as websocket,
    ):
        _receive_event(websocket, "session_state")

        websocket.send_json({"type": "lane_event", "lane": "left"})
        lane_event = _receive_event(websocket, "lane_event")
        expected_lane_event = {
            "type": "lane_event",
            "session_id": "any-id",
            "lane": "left",
        }
        if lane_event != expected_lane_event:
            pytest.fail(
                "unexpected lane_event payload: "
                f"{lane_event!r} != {expected_lane_event!r}",
            )


def test_ws_session_controls_start_stop(ws_song_library: object) -> None:
    """Check that start and stop session commands do not crash."""
    del ws_song_library
    with (
        TestClient(app) as client,
        client.websocket_connect(
            "/ws/session/any-id",
        ) as websocket,
    ):
        _receive_event(websocket, "session_state")

        websocket.send_json({"type": "start_session", "song_id": "toxic"})
        state_event = _receive_event(websocket, "session_state")
        if state_event["state"] != "playing":
            pytest.fail(
                "state_event did not report that the session is playing",
            )

        websocket.send_json({"type": "pause_session"})
        paused_event = _receive_event(websocket, "session_state")
        if paused_event["state"] != "paused":
            pytest.fail("pause_session did not pause the session")

        websocket.send_json({"type": "resume_session"})
        resumed_event = _receive_event(websocket, "session_state")
        if resumed_event["state"] != "playing":
            pytest.fail("resume_session did not resume the session")

        websocket.send_json({"type": "stop_session"})
        stopped_event = _receive_event(websocket, "session_state")
        if stopped_event["state"] != "idle":
            pytest.fail("stop_session did not reset the session to idle")
