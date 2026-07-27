from __future__ import annotations

from fastapi.testclient import TestClient

PASSWORD = "correct-horse"


def credentials(email: str = "ada@example.com", password: str = PASSWORD) -> dict:
    return {"email": email, "password": password}


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestSigningUp:
    def test_creates_an_account_and_signs_it_in(self, client: TestClient) -> None:
        response = client.post("/api/auth/signup", json=credentials())

        assert response.status_code == 201
        body = response.json()
        assert body["user"]["email"] == "ada@example.com"
        assert body["user"]["id"] > 0
        assert body["user"]["created_at"]
        assert body["token"]

    def test_never_echoes_the_password(self, client: TestClient) -> None:
        response = client.post("/api/auth/signup", json=credentials())

        assert PASSWORD not in response.text
        assert "password" not in response.json()["user"]

    def test_rejects_an_existing_account(self, client: TestClient) -> None:
        client.post("/api/auth/signup", json=credentials())

        response = client.post(
            "/api/auth/signup", json=credentials(password="something-else")
        )

        assert response.status_code == 409
        assert "already exists" in response.json()["detail"]

    def test_rejects_an_existing_account_in_another_case(
        self, client: TestClient
    ) -> None:
        client.post("/api/auth/signup", json=credentials())

        response = client.post(
            "/api/auth/signup", json=credentials(email="ADA@Example.com")
        )

        assert response.status_code == 409

    def test_the_token_it_returns_works(self, client: TestClient) -> None:
        token = client.post("/api/auth/signup", json=credentials()).json()["token"]

        response = client.get("/api/auth/me", headers=bearer(token))

        assert response.status_code == 200
        assert response.json()["email"] == "ada@example.com"


class TestSigningIn:
    def test_returns_the_existing_account(self, client: TestClient) -> None:
        created = client.post("/api/auth/signup", json=credentials()).json()

        response = client.post("/api/auth/login", json=credentials())

        assert response.status_code == 200
        assert response.json()["user"] == created["user"]

    def test_issues_a_token_distinct_from_the_last_one(
        self, client: TestClient
    ) -> None:
        first = client.post("/api/auth/signup", json=credentials()).json()["token"]

        second = client.post("/api/auth/login", json=credentials()).json()["token"]

        assert first != second

    def test_rejects_the_wrong_password(self, client: TestClient) -> None:
        client.post("/api/auth/signup", json=credentials())

        response = client.post(
            "/api/auth/login", json=credentials(password="Correct-Horse")
        )

        assert response.status_code == 401
        assert "does not match" in response.json()["detail"]

    def test_tells_a_wrong_password_apart_from_an_unknown_address(
        self, client: TestClient
    ) -> None:
        """
        Deliberate, and the reason is in `routers/auth.py`.

        Someone who mistyped their address needs to be told to create an
        account, not to check a password they typed correctly.
        """
        client.post("/api/auth/signup", json=credentials())

        wrong_password = client.post(
            "/api/auth/login", json=credentials(password="Correct-Horse")
        )
        unknown_address = client.post(
            "/api/auth/login", json=credentials(email="nobody@example.com")
        )

        assert wrong_password.status_code == 401
        assert unknown_address.status_code == 404

    def test_ignores_case_and_whitespace_in_the_address(
        self, client: TestClient
    ) -> None:
        created = client.post("/api/auth/signup", json=credentials()).json()

        response = client.post(
            "/api/auth/login", json=credentials(email=" ADA@Example.com ")
        )

        assert response.json()["user"] == created["user"]

    def test_rejects_an_unknown_account(self, client: TestClient) -> None:
        response = client.post(
            "/api/auth/login", json=credentials(email="nobody@example.com")
        )

        assert response.status_code == 404
        assert "No account found" in response.json()["detail"]

    def test_does_not_create_an_account(self, client: TestClient) -> None:
        client.post("/api/auth/login", json=credentials(email="nobody@example.com"))

        retry = client.post(
            "/api/auth/login", json=credentials(email="nobody@example.com")
        )

        assert retry.status_code == 404

    def test_leaves_an_existing_session_working(self, client: TestClient) -> None:
        """Signing in on a second device must not sign the first one out."""
        first = client.post("/api/auth/signup", json=credentials()).json()["token"]

        client.post("/api/auth/login", json=credentials())

        assert client.get("/api/auth/me", headers=bearer(first)).status_code == 200

    def test_two_accounts_are_distinct(self, client: TestClient) -> None:
        ada = client.post("/api/auth/signup", json=credentials()).json()
        grace = client.post(
            "/api/auth/signup", json=credentials(email="grace@example.com")
        ).json()

        assert ada["user"]["id"] != grace["user"]["id"]
        assert ada["token"] != grace["token"]


class TestWhoAmI:
    def test_returns_the_signed_in_account(self, client: TestClient) -> None:
        token = client.post("/api/auth/signup", json=credentials()).json()["token"]

        body = client.get("/api/auth/me", headers=bearer(token)).json()

        assert body["email"] == "ada@example.com"

    def test_rejects_a_missing_token(self, client: TestClient) -> None:
        response = client.get("/api/auth/me")

        assert response.status_code == 401
        assert response.json()["detail"] == "Sign in to continue."

    def test_rejects_an_unknown_token(self, client: TestClient) -> None:
        response = client.get("/api/auth/me", headers=bearer("not-a-real-token"))

        assert response.status_code == 401

    def test_rejects_a_token_sent_without_the_scheme(self, client: TestClient) -> None:
        token = client.post("/api/auth/signup", json=credentials()).json()["token"]

        response = client.get("/api/auth/me", headers={"Authorization": token})

        assert response.status_code == 401


class TestSigningOut:
    def test_stops_the_token_working(self, client: TestClient) -> None:
        token = client.post("/api/auth/signup", json=credentials()).json()["token"]

        response = client.post("/api/auth/logout", headers=bearer(token))

        assert response.status_code == 204
        assert client.get("/api/auth/me", headers=bearer(token)).status_code == 401

    def test_leaves_this_account_s_other_sessions_alone(
        self, client: TestClient
    ) -> None:
        """One device signing out is not every device signing out."""
        phone = client.post("/api/auth/signup", json=credentials()).json()["token"]
        laptop = client.post("/api/auth/login", json=credentials()).json()["token"]

        client.post("/api/auth/logout", headers=bearer(phone))

        assert client.get("/api/auth/me", headers=bearer(laptop)).status_code == 200

    def test_is_not_an_error_without_a_token(self, client: TestClient) -> None:
        """Signing out when already signed out is the outcome, not a failure."""
        assert client.post("/api/auth/logout").status_code == 204

    def test_is_not_an_error_with_an_unknown_token(self, client: TestClient) -> None:
        response = client.post("/api/auth/logout", headers=bearer("stale-token"))

        assert response.status_code == 204


class TestRequestValidation:
    def test_rejects_a_malformed_email(self, client: TestClient) -> None:
        response = client.post(
            "/api/auth/signup", json=credentials(email="not-an-email")
        )

        assert response.status_code == 422

    def test_rejects_a_missing_password(self, client: TestClient) -> None:
        response = client.post("/api/auth/signup", json={"email": "ada@example.com"})

        assert response.status_code == 422

    def test_rejects_an_empty_password(self, client: TestClient) -> None:
        response = client.post("/api/auth/signup", json=credentials(password=""))

        assert response.status_code == 422

    def test_rejects_a_password_long_enough_to_be_a_workload(
        self, client: TestClient
    ) -> None:
        """scrypt's cost scales with the input, so an unbounded one is a lever."""
        response = client.post(
            "/api/auth/signup", json=credentials(password="x" * 5000)
        )

        assert response.status_code == 422


def test_accounts_do_not_survive_a_restart(settings) -> None:
    """
    Each startup rebuilds the database, so a signed-up account is gone next run.

    Asserted here because it is a product-visible consequence of a container
    decision, and the one most likely to be mistaken for a bug. PL-7 gave
    accounts real passwords and saved drafts; it did not make either durable.
    """
    from app.main import create_app

    with TestClient(create_app(settings)) as first:
        first.post("/api/auth/signup", json=credentials())

    with TestClient(create_app(settings)) as second:
        response = second.post("/api/auth/login", json=credentials())

    assert response.status_code == 404


def test_a_session_does_not_survive_a_restart(settings) -> None:
    from app.main import create_app

    with TestClient(create_app(settings)) as first:
        token = first.post("/api/auth/signup", json=credentials()).json()["token"]

    with TestClient(create_app(settings)) as second:
        response = second.get("/api/auth/me", headers=bearer(token))

    assert response.status_code == 401
