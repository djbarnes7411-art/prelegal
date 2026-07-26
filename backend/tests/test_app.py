"""Health, CORS, and the frontend mount."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health_reports_ok(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ready"}


def test_cors_is_off_by_default(client: TestClient) -> None:
    """Same-origin in the container, so no CORS headers should be advertised."""
    response = client.get(
        "/api/health", headers={"Origin": "http://localhost:3000"}
    )

    assert "access-control-allow-origin" not in response.headers


def test_cors_allows_configured_dev_origins(database_path: Path, tmp_path: Path) -> None:
    settings = Settings(
        database_path=database_path,
        frontend_dir=tmp_path / "no-such-frontend",
        dev_origins=("http://localhost:3000",),
    )

    with TestClient(create_app(settings)) as client:
        response = client.get(
            "/api/health", headers={"Origin": "http://localhost:3000"}
        )

    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_api_still_serves_without_a_frontend_build(client: TestClient) -> None:
    """Backend-only development must not require running `npm run build`."""
    assert client.get("/api/health").status_code == 200


def build_export(root: Path) -> Path:
    """A miniature stand-in for the Next.js export."""
    frontend = root / "out"
    (frontend / "nda").mkdir(parents=True)
    (frontend / "index.html").write_text("<h1>Sign in</h1>", encoding="utf-8")
    (frontend / "nda" / "index.html").write_text("<h1>Mutual NDA</h1>", encoding="utf-8")
    (frontend / "404.html").write_text("<h1>Not found</h1>", encoding="utf-8")
    return frontend


def frontend_client(database_path: Path, tmp_path: Path) -> TestClient:
    settings = Settings(
        database_path=database_path, frontend_dir=build_export(tmp_path)
    )
    return TestClient(create_app(settings))


def test_serves_the_login_page_at_the_root(database_path: Path, tmp_path: Path) -> None:
    with frontend_client(database_path, tmp_path) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert "Sign in" in response.text


def test_serves_a_nested_route(database_path: Path, tmp_path: Path) -> None:
    with frontend_client(database_path, tmp_path) as client:
        response = client.get("/nda/")

    assert response.status_code == 200
    assert "Mutual NDA" in response.text


def test_redirects_a_route_missing_its_trailing_slash(
    database_path: Path, tmp_path: Path
) -> None:
    """The export uses trailing slashes; `/nda` must still reach the page."""
    with frontend_client(database_path, tmp_path) as client:
        response = client.get("/nda", follow_redirects=True)

    assert response.status_code == 200
    assert "Mutual NDA" in response.text


def test_unknown_routes_get_the_generated_404_page(
    database_path: Path, tmp_path: Path
) -> None:
    with frontend_client(database_path, tmp_path) as client:
        response = client.get("/nowhere")

    assert response.status_code == 404
    assert "Not found" in response.text


def test_api_routes_win_over_the_frontend_mount(
    database_path: Path, tmp_path: Path
) -> None:
    """The mount is at `/`, so route ordering is what keeps the API reachable."""
    with frontend_client(database_path, tmp_path) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
