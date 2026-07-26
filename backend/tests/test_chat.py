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
from app.llm import LlmNotConfigured, LlmUnavailable
from app.main import create_app
from app.nda_chat import CoverPageDraft, LlmTurn

REQUEST = {
    "messages": [{"role": "user", "content": "Delaware law, courts in New Castle."}],
    "coverPage": {
        "purpose": "Evaluating a business relationship.",
        "effectiveDate": "2026-07-26",
        "mndaTerm": {"kind": "expires", "years": 1},
        "confidentialityTerm": {"kind": "years", "years": 1},
        "governingLaw": "",
        "jurisdiction": "",
        "modifications": "",
        "partyOne": {
            "companyName": "Northwind Labs, Inc.",
            "signatoryName": "Dana Reyes",
            "signatoryTitle": "Chief Executive Officer",
            "noticeAddress": "legal@northwindlabs.com",
        },
        "partyTwo": {
            "companyName": "",
            "signatoryName": "",
            "signatoryTitle": "",
            "noticeAddress": "",
        },
    },
}


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


def answering(turn: LlmTurn):
    """Substitutes the model with one that always returns `turn`."""

    def complete_structured(messages, answer_model, api_key, completion_fn=None):
        return turn

    return complete_structured


def failing(error: Exception):
    def complete_structured(messages, answer_model, api_key, completion_fn=None):
        raise error

    return complete_structured


class TestAnsweringATurn:
    def test_returns_the_reply_and_the_patch(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.nda_chat.complete_structured",
            answering(
                LlmTurn(
                    reply="Delaware it is. Who signs for the second company?",
                    patch=CoverPageDraft(
                        governing_law="Delaware", jurisdiction="New Castle, DE"
                    ),
                )
            ),
        )

        response = configured_client.post("/api/nda/chat", json=REQUEST)

        assert response.status_code == 200
        assert response.json() == {
            "reply": "Delaware it is. Who signs for the second company?",
            "patch": {"governingLaw": "Delaware", "jurisdiction": "New Castle, DE"},
        }

    def test_leaves_untouched_fields_out_of_the_patch(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """
        A key sent as null would be indistinguishable from an answer of "none"
        once it reached the browser's shallow merge.
        """
        monkeypatch.setattr(
            "app.nda_chat.complete_structured",
            answering(LlmTurn(reply="Noted.", patch=CoverPageDraft(governing_law="Delaware"))),
        )

        patch = configured_client.post("/api/nda/chat", json=REQUEST).json()["patch"]

        assert set(patch) == {"governingLaw"}

    def test_sends_a_party_back_whole(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from app.nda_chat import PartyDraft

        monkeypatch.setattr(
            "app.nda_chat.complete_structured",
            answering(
                LlmTurn(
                    reply="Got the title.",
                    patch=CoverPageDraft(party_one=PartyDraft(signatory_title="President")),
                )
            ),
        )

        patch = configured_client.post("/api/nda/chat", json=REQUEST).json()["patch"]

        assert patch["partyOne"] == {
            "companyName": "Northwind Labs, Inc.",
            "signatoryName": "Dana Reyes",
            "signatoryTitle": "President",
            "noticeAddress": "legal@northwindlabs.com",
        }

    def test_an_empty_patch_is_still_a_valid_turn(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.nda_chat.complete_structured",
            answering(LlmTurn(reply="Which state's law should govern?", patch=CoverPageDraft())),
        )

        response = configured_client.post("/api/nda/chat", json=REQUEST)

        assert response.status_code == 200
        assert response.json()["patch"] == {}


class TestWhenTheAssistantCannotAnswer:
    def test_says_so_when_no_key_is_configured(self, client: TestClient) -> None:
        """The `client` fixture's settings carry no key, as a fresh install would."""
        response = client.post("/api/nda/chat", json=REQUEST)

        assert response.status_code == 503
        assert "not configured" in response.json()["detail"]

    def test_reports_a_provider_failure_as_temporary(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.nda_chat.complete_structured", failing(LlmUnavailable())
        )

        response = configured_client.post("/api/nda/chat", json=REQUEST)

        assert response.status_code == 503
        assert "Try again" in response.json()["detail"]

    def test_does_not_leak_the_underlying_error(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.nda_chat.complete_structured",
            failing(LlmNotConfigured("openrouter key sk-or-v1-secret rejected")),
        )

        detail = configured_client.post("/api/nda/chat", json=REQUEST).json()["detail"]

        assert "sk-or-v1" not in detail


class TestRequestValidation:
    def test_rejects_a_conversation_with_no_messages(
        self, configured_client: TestClient
    ) -> None:
        response = configured_client.post(
            "/api/nda/chat", json={**REQUEST, "messages": []}
        )
        assert response.status_code == 422

    def test_rejects_a_conversation_too_long_to_send(
        self, configured_client: TestClient
    ) -> None:
        messages = [{"role": "user", "content": "hi"}] * 61
        response = configured_client.post(
            "/api/nda/chat", json={**REQUEST, "messages": messages}
        )
        assert response.status_code == 422

    def test_rejects_a_message_too_long_to_send(
        self, configured_client: TestClient
    ) -> None:
        response = configured_client.post(
            "/api/nda/chat",
            json={**REQUEST, "messages": [{"role": "user", "content": "x" * 4001}]},
        )
        assert response.status_code == 422

    def test_accepts_a_cover_page_that_has_not_been_started(
        self, configured_client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "app.nda_chat.complete_structured",
            answering(LlmTurn(reply="Let's begin.", patch=CoverPageDraft())),
        )

        response = configured_client.post(
            "/api/nda/chat",
            json={"messages": [{"role": "user", "content": "hi"}], "coverPage": {}},
        )

        assert response.status_code == 200
