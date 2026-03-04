import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from rythm_jump.api import ws as ws_module
from rythm_jump.engine.session import State
from rythm_jump.main import app


def _receive_event(
    websocket: WebSocketTestSession, event_type: str
) -> dict[str, object]:
    for _ in range(10):
        event = websocket.receive_json()
        if event.get("type") == event_type:
            return event
    raise AssertionError(f"did not receive event type {event_type!r}")


@pytest.fixture(autouse=True)
def _reset_ws_state() -> None:
    ws_module.MAX_SESSIONS = 100
    ws_module.__test_reset_sessions()


def test_ws_session_stream_emits_required_events() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/stream-session") as websocket:
            session_state = _receive_event(websocket, "session_state")
            assert session_state == {
                "type": "session_state",
                "session_id": "stream-session",
                "state": "playing",
            }
            _receive_event(websocket, "clock_tick")
            websocket.send_json({"type": "ping"})
            assert _receive_event(websocket, "pong") == {
                "type": "pong",
                "session_id": "stream-session",
            }

            websocket.send_json({"type": "simulate_events"})
            lane_event = _receive_event(websocket, "lane_event")
            judgement = _receive_event(websocket, "judgement")
            assert lane_event == {
                "type": "lane_event",
                "session_id": "stream-session",
                "lane": "left",
            }
            assert judgement == {
                "type": "judgement",
                "session_id": "stream-session",
                "result": "perfect",
            }


def test_ws_session_rejects_non_object_payload() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/payload-session") as websocket:
            _receive_event(websocket, "session_state")
            websocket.send_json(["ping"])
            assert _receive_event(websocket, "error") == {
                "type": "error",
                "reason": "invalid_payload",
            }


def test_ws_session_rejects_unknown_message_type() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/unknown-session") as websocket:
            _receive_event(websocket, "session_state")
            websocket.send_json({"type": "unknown"})
            assert _receive_event(websocket, "error") == {
                "type": "error",
                "reason": "unknown_type",
            }


def test_ws_session_handles_malformed_json_and_continues() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/malformed-session") as websocket:
            _receive_event(websocket, "session_state")

            websocket.send_text("not-json")
            assert _receive_event(websocket, "error") == {
                "type": "error",
                "reason": "invalid_json",
            }

            websocket.send_json({"type": "ping"})
            assert _receive_event(websocket, "pong") == {
                "type": "pong",
                "session_id": "malformed-session",
            }


def test_ws_disconnect_marks_browser_attached_session_aborted() -> None:
    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/reconnect-session") as websocket:
            _receive_event(websocket, "session_state")

        with client.websocket_connect("/ws/session/reconnect-session") as websocket:
            session_state = _receive_event(websocket, "session_state")
            assert session_state == {
                "type": "session_state",
                "session_id": "reconnect-session",
                "state": "aborted_disconnected",
            }


def test_ws_session_store_evicts_oldest_when_cap_exceeded() -> None:
    ws_module.MAX_SESSIONS = 2

    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/evict-a") as websocket:
            _receive_event(websocket, "session_state")
        with client.websocket_connect("/ws/session/evict-b") as websocket:
            _receive_event(websocket, "session_state")
        with client.websocket_connect("/ws/session/evict-c") as websocket:
            _receive_event(websocket, "session_state")

        with client.websocket_connect("/ws/session/evict-a") as websocket:
            session_state = _receive_event(websocket, "session_state")
            assert session_state == {
                "type": "session_state",
                "session_id": "evict-a",
                "state": "playing",
            }


def test_ws_disconnect_only_aborts_when_last_connection_closes() -> None:
    with TestClient(app) as client:
        with (
            client.websocket_connect("/ws/session/shared-session") as ws_a,
            client.websocket_connect("/ws/session/shared-session") as ws_b,
        ):
            _receive_event(ws_a, "session_state")
            _receive_event(ws_b, "session_state")

            ws_a.close()
            with client.websocket_connect("/ws/session/shared-session") as websocket:
                session_state = _receive_event(websocket, "session_state")
                assert session_state == {
                    "type": "session_state",
                    "session_id": "shared-session",
                    "state": "playing",
                }

        with client.websocket_connect("/ws/session/shared-session") as websocket:
            session_state = _receive_event(websocket, "session_state")
            assert session_state == {
                "type": "session_state",
                "session_id": "shared-session",
                "state": "aborted_disconnected",
            }


def test_ws_eviction_does_not_remove_active_session() -> None:
    ws_module.MAX_SESSIONS = 2

    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/active-a") as ws_a:
            _receive_event(ws_a, "session_state")

            with client.websocket_connect("/ws/session/inactive-b") as ws_b:
                _receive_event(ws_b, "session_state")

            with client.websocket_connect("/ws/session/inactive-c") as ws_c:
                _receive_event(ws_c, "session_state")

            assert "active-a" in ws_module._sessions
            assert "inactive-b" not in ws_module._sessions
            assert "inactive-c" in ws_module._sessions
            assert len(ws_module._sessions) == ws_module.MAX_SESSIONS

        with client.websocket_connect("/ws/session/active-a") as websocket:
            session_state = _receive_event(websocket, "session_state")
            assert session_state == {
                "type": "session_state",
                "session_id": "active-a",
                "state": "aborted_disconnected",
            }


def test_ws_all_active_at_cap_returns_session_capacity_error() -> None:
    ws_module.MAX_SESSIONS = 1

    with TestClient(app) as client:
        with client.websocket_connect("/ws/session/cap-a") as ws_a:
            _receive_event(ws_a, "session_state")

            with client.websocket_connect("/ws/session/cap-b") as ws_b:
                assert ws_b.receive_json() == {
                    "type": "error",
                    "reason": "session_capacity",
                }

            assert len(ws_module._sessions) == 1
            assert "cap-a" in ws_module._sessions


def test_ws_cleanup_when_start_raises_before_clock_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise_start(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("start failed")

    monkeypatch.setattr(ws_module.GameSession, "start", _raise_start)

    with TestClient(app) as client:
        with pytest.raises(RuntimeError, match="start failed"):
            with client.websocket_connect("/ws/session/start-failure-session"):
                pass

    assert ws_module._session_connection_counts.get("start-failure-session", 0) == 0
    assert "start-failure-session" not in ws_module._session_connection_counts
    assert ws_module._sessions["start-failure-session"].state == State.IDLE
