from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import sign_in

SLUG = "pilot-agreement"
MESSAGES = [
    {"role": "user", "content": "I need a pilot agreement"},
    {"role": "assistant", "content": "Who is providing the product?"},
]


def start(client: TestClient, slug: str = SLUG, **body) -> dict:
    """Creates a draft and returns it."""
    response = client.post("/api/documents", json={"documentSlug": slug, **body})
    assert response.status_code == 201, response.text
    return response.json()


class TestStartingADocument:
    def test_returns_the_new_draft(self, signed_in_client: TestClient) -> None:
        draft = start(signed_in_client, messages=MESSAGES)

        assert draft["id"] > 0
        assert draft["documentSlug"] == SLUG
        assert draft["messages"] == MESSAGES
        assert draft["createdAt"] and draft["updatedAt"]

    def test_starts_with_every_field_the_document_defines(
        self, signed_in_client: TestClient
    ) -> None:
        """
        `normalise` returns complete objects, and the browser merges shallowly.

        A partial one coming back would blank whatever it did not mention, so
        this is the invariant the whole patch flow rests on.
        """
        draft = start(signed_in_client)

        assert draft["fields"]
        assert all(key for key in draft["fields"])

    def test_keeps_the_values_it_was_given(
        self, signed_in_client: TestClient
    ) -> None:
        draft = start(signed_in_client, fields={"pilotPeriod": "60 days"})

        assert draft["fields"]["pilotPeriod"] == "60 days"

    def test_drops_a_field_the_document_does_not_have(
        self, signed_in_client: TestClient
    ) -> None:
        draft = start(signed_in_client, fields={"notARealField": "anything"})

        assert "notARealField" not in draft["fields"]

    def test_rejects_a_document_we_cannot_draft(
        self, signed_in_client: TestClient
    ) -> None:
        response = signed_in_client.post(
            "/api/documents", json={"documentSlug": "residential-lease"}
        )

        assert response.status_code == 422
        assert "cannot" in response.json()["detail"] or "not one of" in (
            response.json()["detail"]
        )

    def test_rejects_a_transcript_longer_than_the_cap(
        self, signed_in_client: TestClient
    ) -> None:
        messages = [{"role": "user", "content": "hello"}] * 61

        response = signed_in_client.post(
            "/api/documents", json={"documentSlug": SLUG, "messages": messages}
        )

        assert response.status_code == 422


class TestListingDocuments:
    def test_is_empty_for_a_new_account(self, signed_in_client: TestClient) -> None:
        assert signed_in_client.get("/api/documents").json() == []

    def test_shows_the_most_recently_worked_on_first(
        self, signed_in_client: TestClient
    ) -> None:
        first = start(signed_in_client)
        second = start(signed_in_client, slug="mutual-nda")

        listed = [draft["id"] for draft in signed_in_client.get("/api/documents").json()]

        assert listed == [second["id"], first["id"]]

    def test_carries_the_values_but_not_the_conversation(
        self, signed_in_client: TestClient
    ) -> None:
        """The list builds titles and progress from the values; it shows no chat."""
        start(signed_in_client, fields={"pilotPeriod": "60 days"}, messages=MESSAGES)

        summary = signed_in_client.get("/api/documents").json()[0]

        assert summary["fields"]["pilotPeriod"] == "60 days"
        assert "messages" not in summary


class TestOpeningADocument:
    def test_returns_the_values_and_the_conversation(
        self, signed_in_client: TestClient
    ) -> None:
        draft = start(
            signed_in_client, fields={"pilotPeriod": "60 days"}, messages=MESSAGES
        )

        body = signed_in_client.get(f"/api/documents/{draft['id']}").json()

        assert body["fields"]["pilotPeriod"] == "60 days"
        assert body["messages"] == MESSAGES

    def test_reports_an_id_that_does_not_exist(
        self, signed_in_client: TestClient
    ) -> None:
        response = signed_in_client.get("/api/documents/4321")

        assert response.status_code == 404
        assert "No document found" in response.json()["detail"]


class TestSavingADocument:
    def test_replaces_the_values_and_the_conversation(
        self, signed_in_client: TestClient
    ) -> None:
        draft = start(signed_in_client, messages=MESSAGES)

        response = signed_in_client.put(
            f"/api/documents/{draft['id']}",
            json={"fields": {"pilotPeriod": "90 days"}, "messages": []},
        )

        assert response.status_code == 200
        assert response.json()["fields"]["pilotPeriod"] == "90 days"
        assert response.json()["messages"] == []

    def test_leaves_the_document_it_is_a_draft_of_alone(
        self, signed_in_client: TestClient
    ) -> None:
        """No slug is accepted, so a Pilot Agreement cannot be turned into an NDA."""
        draft = start(signed_in_client)

        body = signed_in_client.put(
            f"/api/documents/{draft['id']}",
            json={"documentSlug": "mutual-nda", "fields": {}, "messages": []},
        ).json()

        assert body["documentSlug"] == SLUG

    def test_drops_a_field_the_document_does_not_have(
        self, signed_in_client: TestClient
    ) -> None:
        draft = start(signed_in_client)

        body = signed_in_client.put(
            f"/api/documents/{draft['id']}",
            json={"fields": {"notARealField": "anything"}, "messages": []},
        ).json()

        assert "notARealField" not in body["fields"]

    def test_reports_an_id_that_does_not_exist(
        self, signed_in_client: TestClient
    ) -> None:
        response = signed_in_client.put(
            "/api/documents/4321", json={"fields": {}, "messages": []}
        )

        assert response.status_code == 404


class TestDeletingADocument:
    def test_it_is_gone(self, signed_in_client: TestClient) -> None:
        draft = start(signed_in_client)

        response = signed_in_client.delete(f"/api/documents/{draft['id']}")

        assert response.status_code == 204
        assert signed_in_client.get(f"/api/documents/{draft['id']}").status_code == 404

    def test_reports_an_id_that_does_not_exist(
        self, signed_in_client: TestClient
    ) -> None:
        assert signed_in_client.delete("/api/documents/4321").status_code == 404


class TestSomeoneElseSDocument:
    """
    Another account's draft is answered exactly as one that never existed.

    A 403 would confirm the id belongs to *someone*, which turns the
    autoincrementing id into a way to count other people's work.
    """

    def test_is_not_in_the_list(self, client: TestClient, settings) -> None:
        ada = sign_in(client, "ada@example.com")
        start(ada)

        grace = sign_in(client, "grace@example.com")

        assert grace.get("/api/documents").json() == []

    def test_cannot_be_opened(self, client: TestClient) -> None:
        draft = start(sign_in(client, "ada@example.com"))

        grace = sign_in(client, "grace@example.com")
        response = grace.get(f"/api/documents/{draft['id']}")

        assert response.status_code == 404
        assert "No document found" in response.json()["detail"]

    def test_cannot_be_saved_over(self, client: TestClient) -> None:
        ada_client = sign_in(client, "ada@example.com")
        draft = start(ada_client, fields={"pilotPeriod": "60 days"})
        ada_token = client.headers["Authorization"]

        grace = sign_in(client, "grace@example.com")
        assert (
            grace.put(
                f"/api/documents/{draft['id']}",
                json={"fields": {"pilotPeriod": "wiped"}, "messages": []},
            ).status_code
            == 404
        )

        client.headers["Authorization"] = ada_token
        body = client.get(f"/api/documents/{draft['id']}").json()
        assert body["fields"]["pilotPeriod"] == "60 days"

    def test_cannot_be_deleted(self, client: TestClient) -> None:
        ada_client = sign_in(client, "ada@example.com")
        draft = start(ada_client)
        ada_token = client.headers["Authorization"]

        grace = sign_in(client, "grace@example.com")
        assert grace.delete(f"/api/documents/{draft['id']}").status_code == 404

        client.headers["Authorization"] = ada_token
        assert client.get(f"/api/documents/{draft['id']}").status_code == 200


class TestWithoutASession:
    """Every route needs one, including the ones that only read."""

    def test_the_list_is_refused(self, client: TestClient) -> None:
        response = client.get("/api/documents")

        assert response.status_code == 401
        assert response.json()["detail"] == "Sign in to continue."

    def test_starting_one_is_refused(self, client: TestClient) -> None:
        response = client.post("/api/documents", json={"documentSlug": SLUG})

        assert response.status_code == 401

    def test_opening_one_is_refused(self, client: TestClient) -> None:
        assert client.get("/api/documents/1").status_code == 401

    def test_saving_one_is_refused(self, client: TestClient) -> None:
        response = client.put(
            "/api/documents/1", json={"fields": {}, "messages": []}
        )

        assert response.status_code == 401

    def test_deleting_one_is_refused(self, client: TestClient) -> None:
        assert client.delete("/api/documents/1").status_code == 401

    def test_a_stale_token_is_refused(self, client: TestClient) -> None:
        signed_in = sign_in(client)
        token = signed_in.headers["Authorization"]
        signed_in.post("/api/auth/logout")

        client.headers["Authorization"] = token

        assert client.get("/api/documents").status_code == 401


class TestADocumentThatLeftTheCatalog:
    """
    A saved draft outlives the catalog entry it was made against.

    Nothing removes a document today, so this is reached by writing a slug the
    catalog has never had — which is exactly the state a withdrawn template
    would leave behind.
    """

    def test_opening_it_says_the_document_is_gone(
        self, signed_in_client: TestClient, database_path
    ) -> None:
        from contextlib import closing

        from app.db import connect

        draft = start(signed_in_client)
        with closing(connect(database_path)) as connection:
            connection.execute(
                "UPDATE drafts SET document_slug = ? WHERE id = ?",
                ("withdrawn-template", draft["id"]),
            )
            connection.commit()

        response = signed_in_client.get(f"/api/documents/{draft['id']}")

        assert response.status_code == 410
        assert "no longer" in response.json()["detail"]

    def test_it_is_left_out_of_the_list_rather_than_breaking_it(
        self, signed_in_client: TestClient, database_path
    ) -> None:
        """One withdrawn template must not cost the sight of everything else."""
        from contextlib import closing

        from app.db import connect

        stale = start(signed_in_client)
        kept = start(signed_in_client, slug="mutual-nda")
        with closing(connect(database_path)) as connection:
            connection.execute(
                "UPDATE drafts SET document_slug = ? WHERE id = ?",
                ("withdrawn-template", stale["id"]),
            )
            connection.commit()

        listed = signed_in_client.get("/api/documents").json()

        assert [draft["id"] for draft in listed] == [kept["id"]]

    def test_it_can_still_be_deleted(
        self, signed_in_client: TestClient, database_path
    ) -> None:
        """Being unable to open something is no reason to be stuck with it."""
        from contextlib import closing

        from app.db import connect

        draft = start(signed_in_client)
        with closing(connect(database_path)) as connection:
            connection.execute(
                "UPDATE drafts SET document_slug = ? WHERE id = ?",
                ("withdrawn-template", draft["id"]),
            )
            connection.commit()

        assert signed_in_client.delete(f"/api/documents/{draft['id']}").status_code == 204


def test_drafts_do_not_survive_a_restart(settings) -> None:
    """Same as accounts: the database is rebuilt from schema.sql every startup."""
    from app.main import create_app

    with TestClient(create_app(settings)) as first:
        start(sign_in(first))

    with TestClient(create_app(settings)) as second:
        listed = sign_in(second).get("/api/documents").json()

    assert listed == []
