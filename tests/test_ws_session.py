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
