"""
The chat endpoint.

The model is substituted in every test here — nothing in this suite reaches the
network. What is being checked is the wire format and what the user is told when
the assistant cannot answer.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.documents.chat import Selection, draft_model
from app.llm import LlmNotConfigured, LlmUnavailable
from app.main import create_app

SUBSTITUTE = "app.documents.chat.complete_structured"

REQUEST = {
    "messages": [{"role": "user", "content": "Delaware law, courts in New Castle."}],
    "documentSlug": "pilot-agreement",
    "fields": {
        "provider": {
            "companyName": "Northwind Labs, Inc.",
            "signatoryName": "Dana Reyes",
            "signatoryTitle": "Chief Executive Officer",
            "noticeAddress": "legal@northwindlabs.com",
        },
        "customer": {
            "companyName": "",
            "signatoryName": "",
            "signatoryTitle": "",
            "noticeAddress": "",
        },
        "pilotPeriod": "60 days",
        "effectiveDate": "2026-07-26",
        "governingLaw": "",
        "chosenCourts": "",
    },
}

CHOOSING = {"messages": [{"role": "user", "content": "I need an NDA"}], "fields": {}}


@pytest.fixture
def configured_settings(database_path: Path, tmp_path: Path) -> Settings:
    """An app that believes it has a key. The model itself is still substituted."""
    return Settings(
        database_path=database_path,
        frontend_dir=tmp_path / "no-such-frontend",
        openrouter_api_key="test-key",
    )


@pytest.fixture
def configured_client(configured_settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(configured_settings)) as client:
        yield client


def drafting(slug: str, reply: str, patch: dict | None = None):
    """Substitutes the model with one that answers this document's schema."""
    answer = draft_model(slug).model_validate({"reply": reply, "patch": patch or {}})

    def complete_structured(messages, answer_model, api_key, completion_fn=None):
        return answer

    return complete_structured


def choosing(reply: str, slug: str | None):
    answer = Selection(reply=reply, document_slug=slug)

    def complete_structured(messages, answer_model, api_key, completion_fn=None):
        return answer

    return complete_structured


def failing(error: Exception):
    def complete_structured(messages, answer_model, api_key, completion_fn=None):
        raise error

    return complete_structured


class TestChoosingADocument:
    def test_returns_the_slug_it_settled_on(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            SUBSTITUTE, choosing("Let's draft a Mutual NDA. Who are the two companies?", "mutual-nda")
        )

        body = configured_client.post("/api/chat", json=CHOOSING).json()

        assert body["documentSlug"] == "mutual-nda"
        assert body["patch"] == {}

    def test_reports_no_choice_when_nothing_matches(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            SUBSTITUTE,
            choosing(
                "I can't draft an employment contract. The closest I have is a "
                "Design Partner Agreement. Shall we start that?",
                None,
            ),
        )

        body = configured_client.post("/api/chat", json=CHOOSING).json()

        assert body["documentSlug"] is None
        assert "employment contract" in body["reply"]

    def test_refuses_a_slug_that_is_not_in_the_catalog(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """
        A slug we do not have would leave the panel with nothing to show and the
        next turn with nothing to draft, so it is treated as no choice at all.
        """
        monkeypatch.setattr(
            SUBSTITUTE, choosing("Starting your employment contract.", "employment-contract")
        )

        body = configured_client.post("/api/chat", json=CHOOSING).json()

        assert body["documentSlug"] is None

    def test_an_unknown_slug_in_the_request_starts_the_conversation_over(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A 422 would strand the user; asking again is recoverable."""
        monkeypatch.setattr(SUBSTITUTE, choosing("Which document did you want?", None))

        response = configured_client.post(
            "/api/chat", json={**CHOOSING, "documentSlug": "not-a-document"}
        )

        assert response.status_code == 200
        assert response.json()["documentSlug"] is None


class TestAnsweringATurn:
    def test_returns_the_reply_and_the_patch(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            SUBSTITUTE,
            drafting(
                "pilot-agreement",
                "Delaware it is. Who signs for the customer?",
                {"governingLaw": "Delaware", "chosenCourts": "New Castle, DE"},
            ),
        )

        response = configured_client.post("/api/chat", json=REQUEST)

        assert response.status_code == 200
        assert response.json() == {
            "reply": "Delaware it is. Who signs for the customer?",
            "documentSlug": "pilot-agreement",
            "patch": {"governingLaw": "Delaware", "chosenCourts": "New Castle, DE"},
        }

    def test_leaves_untouched_fields_out_of_the_patch(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """
        A key sent as null would be indistinguishable from an answer of "none"
        once it reached the browser's shallow merge.
        """
        monkeypatch.setattr(
            SUBSTITUTE,
            drafting("pilot-agreement", "Noted. What next?", {"governingLaw": "Delaware"}),
        )

        patch = configured_client.post("/api/chat", json=REQUEST).json()["patch"]

        assert set(patch) == {"governingLaw"}

    def test_sends_a_party_back_whole(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            SUBSTITUTE,
            drafting(
                "pilot-agreement",
                "Got the title. What else?",
                {"provider": {"signatoryTitle": "President"}},
            ),
        )

        patch = configured_client.post("/api/chat", json=REQUEST).json()["patch"]

        assert patch["provider"] == {
            "companyName": "Northwind Labs, Inc.",
            "signatoryName": "Dana Reyes",
            "signatoryTitle": "President",
            "noticeAddress": "legal@northwindlabs.com",
        }

    def test_an_empty_patch_is_still_a_valid_turn(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            SUBSTITUTE, drafting("pilot-agreement", "Which state's law should govern?")
        )

        response = configured_client.post("/api/chat", json=REQUEST)

        assert response.status_code == 200
        assert response.json()["patch"] == {}


class TestWhenTheAssistantCannotAnswer:
    def test_says_so_when_no_key_is_configured(self, client: TestClient) -> None:
        """The `client` fixture's settings carry no key, as a fresh install would."""
        response = client.post("/api/chat", json=REQUEST)

        assert response.status_code == 503
        assert "not configured" in response.json()["detail"]

    def test_reports_a_provider_failure_as_temporary(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(SUBSTITUTE, failing(LlmUnavailable()))

        response = configured_client.post("/api/chat", json=REQUEST)

        assert response.status_code == 503
        assert "Try again" in response.json()["detail"]

    def test_does_not_leak_the_underlying_error(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            SUBSTITUTE,
            failing(LlmNotConfigured("openrouter key sk-or-v1-secret rejected")),
        )

        detail = configured_client.post("/api/chat", json=REQUEST).json()["detail"]

        assert "sk-or-v1" not in detail


class TestRequestValidation:
    def test_rejects_a_conversation_with_no_messages(
        self, configured_client: TestClient
    ) -> None:
        response = configured_client.post("/api/chat", json={**REQUEST, "messages": []})
        assert response.status_code == 422

    def test_rejects_a_conversation_too_long_to_send(
        self, configured_client: TestClient
    ) -> None:
        messages = [{"role": "user", "content": "hi"}] * 61
        response = configured_client.post(
            "/api/chat", json={**REQUEST, "messages": messages}
        )
        assert response.status_code == 422

    def test_rejects_a_message_too_long_to_send(
        self, configured_client: TestClient
    ) -> None:
        response = configured_client.post(
            "/api/chat",
            json={**REQUEST, "messages": [{"role": "user", "content": "x" * 4001}]},
        )
        assert response.status_code == 422

    def test_accepts_a_document_that_has_not_been_started(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            SUBSTITUTE, drafting("pilot-agreement", "Let's begin. Who are the parties?")
        )

        response = configured_client.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": "hi"}],
                "documentSlug": "pilot-agreement",
                "fields": {},
            },
        )

        assert response.status_code == 200

    def test_ignores_values_the_document_does_not_have(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """
        Keeps the prompt bounded by the document rather than by whatever the
        client sent, which is why `fields` needs no size cap of its own.
        """
        monkeypatch.setattr(
            SUBSTITUTE, drafting("pilot-agreement", "Noted. What next?")
        )

        response = configured_client.post(
            "/api/chat",
            json={
                **REQUEST,
                "fields": {**REQUEST["fields"], "notAField": "x" * 50_000},
            },
        )

        assert response.status_code == 200
