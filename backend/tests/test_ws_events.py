import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from rhythm_jump.api import ws as ws_module
from rhythm_jump.main import app


def _receive_event(websocket: WebSocketTestSession, event_type: str) -> dict[str, object]:
    for _ in range(10):
        event = websocket.receive_json()
        if event.get('type') == event_type:
            return event
    raise AssertionError(f'did not receive event type {event_type!r}')


@pytest.fixture(autouse=True)
def _reset_ws_state() -> None:
    ws_module.MAX_SESSIONS = 100
    ws_module.__test_reset_sessions()


def test_ws_session_stream_emits_required_events() -> None:
    with TestClient(app) as client:
        with client.websocket_connect('/ws/session/stream-session') as websocket:
            session_state = _receive_event(websocket, 'session_state')
            assert session_state == {
                'type': 'session_state',
                'session_id': 'stream-session',
                'state': 'playing',
            }
            _receive_event(websocket, 'clock_tick')
            websocket.send_json({'type': 'ping'})
            assert _receive_event(websocket, 'pong') == {
                'type': 'pong',
                'session_id': 'stream-session',
            }

            websocket.send_json({'type': 'simulate_events'})
            lane_event = _receive_event(websocket, 'lane_event')
            judgement = _receive_event(websocket, 'judgement')
            assert lane_event == {
                'type': 'lane_event',
                'session_id': 'stream-session',
                'lane': 'left',
            }
            assert judgement == {
                'type': 'judgement',
                'session_id': 'stream-session',
                'result': 'perfect',
            }


def test_ws_session_rejects_non_object_payload() -> None:
    with TestClient(app) as client:
        with client.websocket_connect('/ws/session/payload-session') as websocket:
            _receive_event(websocket, 'session_state')
            websocket.send_json(['ping'])  # type: ignore[arg-type]
            assert _receive_event(websocket, 'error') == {
                'type': 'error',
                'reason': 'invalid_payload',
            }


def test_ws_session_rejects_unknown_message_type() -> None:
    with TestClient(app) as client:
        with client.websocket_connect('/ws/session/unknown-session') as websocket:
            _receive_event(websocket, 'session_state')
            websocket.send_json({'type': 'unknown'})
            assert _receive_event(websocket, 'error') == {
                'type': 'error',
                'reason': 'unknown_type',
            }


def test_ws_session_handles_malformed_json_and_continues() -> None:
    with TestClient(app) as client:
        with client.websocket_connect('/ws/session/malformed-session') as websocket:
            _receive_event(websocket, 'session_state')

            websocket.send_text('not-json')
            assert _receive_event(websocket, 'error') == {
                'type': 'error',
                'reason': 'invalid_json',
            }

            websocket.send_json({'type': 'ping'})
            assert _receive_event(websocket, 'pong') == {
                'type': 'pong',
                'session_id': 'malformed-session',
            }


def test_ws_disconnect_marks_browser_attached_session_aborted() -> None:
    with TestClient(app) as client:
        with client.websocket_connect('/ws/session/reconnect-session') as websocket:
            _receive_event(websocket, 'session_state')

        with client.websocket_connect('/ws/session/reconnect-session') as websocket:
            session_state = _receive_event(websocket, 'session_state')
            assert session_state == {
                'type': 'session_state',
                'session_id': 'reconnect-session',
                'state': 'aborted_disconnected',
            }


def test_ws_session_store_evicts_oldest_when_cap_exceeded() -> None:
    ws_module.MAX_SESSIONS = 2

    with TestClient(app) as client:
        with client.websocket_connect('/ws/session/evict-a') as websocket:
            _receive_event(websocket, 'session_state')
        with client.websocket_connect('/ws/session/evict-b') as websocket:
            _receive_event(websocket, 'session_state')
        with client.websocket_connect('/ws/session/evict-c') as websocket:
            _receive_event(websocket, 'session_state')

        with client.websocket_connect('/ws/session/evict-a') as websocket:
            session_state = _receive_event(websocket, 'session_state')
            assert session_state == {
                'type': 'session_state',
                'session_id': 'evict-a',
                'state': 'playing',
            }


def test_ws_disconnect_only_aborts_when_last_connection_closes() -> None:
    with TestClient(app) as client:
        with (
            client.websocket_connect('/ws/session/shared-session') as ws_a,
            client.websocket_connect('/ws/session/shared-session') as ws_b,
        ):
            _receive_event(ws_a, 'session_state')
            _receive_event(ws_b, 'session_state')

            ws_a.close()
            with client.websocket_connect('/ws/session/shared-session') as websocket:
                session_state = _receive_event(websocket, 'session_state')
                assert session_state == {
                    'type': 'session_state',
                    'session_id': 'shared-session',
                    'state': 'playing',
                }

        with client.websocket_connect('/ws/session/shared-session') as websocket:
            session_state = _receive_event(websocket, 'session_state')
            assert session_state == {
                'type': 'session_state',
                'session_id': 'shared-session',
                'state': 'aborted_disconnected',
            }
