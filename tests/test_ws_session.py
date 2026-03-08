"""Additional WebSocket tests for Rhythm Jump instrumentation."""

import pytest
from fastapi.testclient import TestClient

from rythm_jump.main import app

_EXPECTED_LED_LEVELS = 2


def test_start_session_emits_led_frame() -> None:
    """The server should emit LED frame updates after starting a session."""
    with (
        TestClient(app) as client,
        client.websocket_connect(
            "/ws/session/default-session",
        ) as socket,
    ):
        socket.receive_json()  # initial session_state
        socket.send_json({"type": "start_session", "song_id": "toxic"})

        led_frame: dict[str, object] | None = None
        for _ in range(30):
            payload = socket.receive_json()
            if payload.get("type") == "led_frame":
                led_frame = payload
                break
        if led_frame is None:
            pytest.fail("expected led_frame but none arrived")
        if "levels" not in led_frame:
            pytest.fail("led_frame payload missing levels key")
        if len(led_frame["levels"]) != _EXPECTED_LED_LEVELS:
            pytest.fail("led_frame levels should contain two entries")


def test_playback_emits_bar_frame_event() -> None:
    """Playback emits bar frame payloads with the expected fields."""
    with (
        TestClient(app) as client,
        client.websocket_connect(
            "/ws/session/default-session",
        ) as socket,
    ):
        socket.receive_json()  # initial session_state
        socket.send_json({"type": "start_session", "song_id": "toxic"})

        bar_frame: dict[str, object] | None = None
        for _ in range(60):
            payload = socket.receive_json()
            if payload.get("type") == "bar_frame":
                bar_frame = payload
                break

        if bar_frame is None:
            pytest.fail("expected bar_frame but none arrived")
        if bar_frame["lane"] not in {"left", "right"}:
            pytest.fail("bar_frame did not report a valid lane")
        if not isinstance(bar_frame["hit_time_ms"], int):
            pytest.fail("bar_frame hit_time_ms must be an int")
        if not isinstance(bar_frame["travel_time_ms"], int):
            pytest.fail("bar_frame travel_time_ms must be an int")
        if not isinstance(bar_frame["progress_ms"], int):
            pytest.fail("bar_frame progress_ms must be an int")
        if not isinstance(bar_frame["remaining_ms"], int):
            pytest.fail("bar_frame remaining_ms must be an int")
