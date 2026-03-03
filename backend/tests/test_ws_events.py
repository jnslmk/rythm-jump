from fastapi.testclient import TestClient

from rhythm_jump.main import app


def test_ws_session_sends_snapshot_and_responds_to_ping() -> None:
    with TestClient(app) as client:
        with client.websocket_connect('/ws/session/test-session') as websocket:
            initial_event = websocket.receive_json()
            assert initial_event == {
                'type': 'session_snapshot',
                'session_id': 'test-session',
                'state': 'idle',
            }

            websocket.send_json({'type': 'ping'})
            response_event = websocket.receive_json()
            assert response_event == {'type': 'pong', 'session_id': 'test-session'}


def test_ws_session_rejects_non_object_payload() -> None:
    with TestClient(app) as client:
        with client.websocket_connect('/ws/session/test-session') as websocket:
            websocket.receive_json()
            websocket.send_json(['ping'])
            assert websocket.receive_json() == {'type': 'error', 'reason': 'invalid_payload'}


def test_ws_session_rejects_unknown_message_type() -> None:
    with TestClient(app) as client:
        with client.websocket_connect('/ws/session/test-session') as websocket:
            websocket.receive_json()
            websocket.send_json({'type': 'unknown'})
            assert websocket.receive_json() == {'type': 'error', 'reason': 'unknown_type'}


def test_ws_session_handles_malformed_json_and_continues() -> None:
    with TestClient(app) as client:
        with client.websocket_connect('/ws/session/test-session') as websocket:
            websocket.receive_json()

            websocket.send_text('not-json')
            assert websocket.receive_json() == {'type': 'error', 'reason': 'invalid_json'}

            websocket.send_json({'type': 'ping'})
            assert websocket.receive_json() == {
                'type': 'pong',
                'session_id': 'test-session',
            }
