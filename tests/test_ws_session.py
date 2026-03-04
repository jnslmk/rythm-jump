from fastapi.testclient import TestClient

from rythm_jump.main import app


def test_start_session_emits_led_frame() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/default-session") as socket:
            socket.receive_json()  # initial session_state
            socket.send_json({"type": "start_session", "song_id": "demo"})

            led_frame = None
            for _ in range(30):
                payload = socket.receive_json()
                if payload.get("type") == "led_frame":
                    led_frame = payload
                    break
            assert led_frame is not None, "expected led_frame but none arrived"
            assert "levels" in led_frame
            assert len(led_frame["levels"]) == 2


def test_playback_emits_bar_frame_event() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/default-session") as socket:
            socket.receive_json()  # initial session_state
            socket.send_json({"type": "start_session", "song_id": "demo"})

            bar_frame = None
            for _ in range(60):
                payload = socket.receive_json()
                if payload.get("type") == "bar_frame" and payload.get("lane") == "left":
                    bar_frame = payload
                    break

            assert bar_frame is not None, "expected bar_frame but none arrived"
            assert isinstance(bar_frame["hit_time_ms"], int)
            assert isinstance(bar_frame["travel_time_ms"], int)
            assert isinstance(bar_frame["progress_ms"], int)
            assert isinstance(bar_frame["remaining_ms"], int)
