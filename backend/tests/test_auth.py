from __future__ import annotations

from fastapi.testclient import TestClient


def test_signup_creates_an_account(client: TestClient) -> None:
    response = client.post(
        "/api/auth/signup", json={"email": "ada@example.com", "password": "hunter2"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "ada@example.com"
    assert body["id"] > 0
    assert body["created_at"]


def test_signup_never_echoes_the_password(client: TestClient) -> None:
    response = client.post(
        "/api/auth/signup", json={"email": "ada@example.com", "password": "hunter2"}
    )

    assert "hunter2" not in response.text
    assert "password" not in response.json()


def test_signup_rejects_an_existing_account(client: TestClient) -> None:
    client.post(
        "/api/auth/signup", json={"email": "ada@example.com", "password": "hunter2"}
    )

    response = client.post(
        "/api/auth/signup", json={"email": "ada@example.com", "password": "other"}
    )

    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_signup_rejects_an_existing_account_in_another_case(
    client: TestClient,
) -> None:
    client.post(
        "/api/auth/signup", json={"email": "ada@example.com", "password": "hunter2"}
    )

    response = client.post(
        "/api/auth/signup", json={"email": "ADA@Example.com", "password": "hunter2"}
    )

    assert response.status_code == 409


def test_login_returns_the_existing_account(client: TestClient) -> None:
    created = client.post(
        "/api/auth/signup", json={"email": "ada@example.com", "password": "hunter2"}
    ).json()

    response = client.post(
        "/api/auth/login", json={"email": "ada@example.com", "password": "hunter2"}
    )

    assert response.status_code == 200
    assert response.json() == created


def test_login_ignores_the_password(client: TestClient) -> None:
    """PL-4 has no authentication — this is the documented behaviour, not a bug."""
    client.post(
        "/api/auth/signup", json={"email": "ada@example.com", "password": "hunter2"}
    )

    response = client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": "completely-different"},
    )

    assert response.status_code == 200


def test_login_ignores_case_and_whitespace(client: TestClient) -> None:
    created = client.post(
        "/api/auth/signup", json={"email": "ada@example.com", "password": "hunter2"}
    ).json()

    response = client.post(
        "/api/auth/login", json={"email": " ADA@Example.com ", "password": "hunter2"}
    )

    assert response.json() == created


def test_login_rejects_an_unknown_account(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "hunter2"}
    )

    assert response.status_code == 404
    assert "No account found" in response.json()["detail"]


def test_login_does_not_create_an_account(client: TestClient) -> None:
    client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "hunter2"}
    )

    retry = client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "hunter2"}
    )

    assert retry.status_code == 404


def test_two_accounts_are_distinct(client: TestClient) -> None:
    ada = client.post(
        "/api/auth/signup", json={"email": "ada@example.com", "password": "hunter2"}
    ).json()
    grace = client.post(
        "/api/auth/signup", json={"email": "grace@example.com", "password": "hunter2"}
    ).json()

    assert ada["id"] != grace["id"]


def test_rejects_a_malformed_email(client: TestClient) -> None:
    response = client.post(
        "/api/auth/signup", json={"email": "not-an-email", "password": "hunter2"}
    )

    assert response.status_code == 422


def test_rejects_a_missing_password(client: TestClient) -> None:
    """The field is unused, but the API keeps the shape real auth will need."""
    response = client.post("/api/auth/signup", json={"email": "ada@example.com"})

    assert response.status_code == 422


def test_rejects_an_empty_password(client: TestClient) -> None:
    response = client.post(
        "/api/auth/signup", json={"email": "ada@example.com", "password": ""}
    )

    assert response.status_code == 422


def test_accounts_do_not_survive_a_restart(settings) -> None:
    """
    Each startup rebuilds the database, so a signed-up account is gone next run.

    Asserted here because it is a product-visible consequence of a container
    decision, and the one most likely to be mistaken for a bug.
    """
    from app.main import create_app

    with TestClient(create_app(settings)) as first:
        first.post(
            "/api/auth/signup", json={"email": "ada@example.com", "password": "hunter2"}
        )

    with TestClient(create_app(settings)) as second:
        response = second.post(
            "/api/auth/login", json={"email": "ada@example.com", "password": "hunter2"}
        )

    assert response.status_code == 404
