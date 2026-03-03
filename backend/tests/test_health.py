from fastapi.testclient import TestClient

from rhythm_jump.main import app


def test_health_endpoint_returns_ok() -> None:
    with TestClient(app) as client:
        response = client.get('/api/health')

    assert response.status_code == 200
    assert response.json() == {'ok': True}
