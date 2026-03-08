from fastapi.testclient import TestClient

from rythm_jump.main import app

HTTP_OK = 200


def test_health_endpoint_returns_ok() -> None:
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == HTTP_OK
    assert response.json() == {"ok": True}
