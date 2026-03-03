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
