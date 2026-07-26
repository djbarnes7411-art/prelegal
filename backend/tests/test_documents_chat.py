"""
One turn of the drafting conversation.

Nothing here reaches the network: the completion function is substituted
throughout, as it is everywhere else in this suite.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.documents.catalog import catalog
from app.documents.chat import (
    ChatMessage,
    MAX_REPLY,
    Selection,
    build_messages,
    drafting_prompt,
    draft_model,
    ensure_follow_up,
    run_turn,
    selection_prompt,
)
from app.documents.values import empty_party, normalise
from app.llm import LlmUnavailable

HELLO = [ChatMessage(role="user", content="hello")]


def completion(payload: dict):
    """Stands in for `litellm.completion`, shaped like its return value."""

    def call(**kwargs):
        model = kwargs["response_format"]
        content = model.model_validate(payload).model_dump_json(by_alias=True)

        class Message:
            def __init__(self) -> None:
                self.content = content

        class Choice:
            def __init__(self) -> None:
                self.message = Message()

        class Response:
            def __init__(self) -> None:
                self.choices = [Choice()]

        return Response()

    return call


class TestChoosingADocument:
    def test_settles_on_a_document_it_recognises(self) -> None:
        turn = run_turn(
            None,
            {},
            HELLO,
            "key",
            completion({"reply": "Starting your NDA. Who are the parties?", "documentSlug": "mutual-nda"}),
        )

        assert turn.document_slug == "mutual-nda"
        assert turn.patch == {}

    def test_leaves_the_choice_open_when_nothing_fits(self) -> None:
        turn = run_turn(
            None,
            {},
            HELLO,
            "key",
            completion(
                {
                    "reply": "I can't draft a lease. The closest I have is a "
                    "Cloud Service Agreement. Would that help?",
                    "documentSlug": None,
                }
            ),
        )

        assert turn.document_slug is None

    def test_drops_a_slug_that_is_not_in_the_catalog(self) -> None:
        turn = run_turn(
            None, {}, HELLO, "key", completion({"reply": "ok", "documentSlug": "lease"})
        )

        assert turn.document_slug is None

    def test_the_prompt_lists_every_document_and_its_aliases(self) -> None:
        prompt = selection_prompt()

        for document in catalog().values():
            assert document.slug in prompt
            assert document.summary in prompt

        assert "non-disclosure agreement" in prompt
        assert "Never invent a slug" in prompt


class TestDrafting:
    def test_applies_what_the_model_extracted(self) -> None:
        turn = run_turn(
            "pilot-agreement",
            {},
            HELLO,
            "key",
            completion(
                {
                    "reply": "Noted. Which state's law governs?",
                    "patch": {"pilotPeriod": "60 days"},
                }
            ),
        )

        assert turn.patch == {"pilotPeriod": "60 days"}
        assert turn.document_slug == "pilot-agreement"

    def test_keeps_the_document_the_caller_was_already_drafting(self) -> None:
        turn = run_turn(
            "pilot-agreement",
            {},
            HELLO,
            "key",
            completion({"reply": "What next?", "patch": {}}),
        )

        assert turn.document_slug == "pilot-agreement"

    def test_a_party_comes_back_whole(self) -> None:
        state = {"provider": {**empty_party(), "companyName": "Acme"}}

        turn = run_turn(
            "pilot-agreement",
            state,
            HELLO,
            "key",
            completion(
                {
                    "reply": "Got it. And their title?",
                    "patch": {"provider": {"signatoryName": "Dana Lee"}},
                }
            ),
        )

        assert turn.patch["provider"] == {
            "companyName": "Acme",
            "signatoryName": "Dana Lee",
            "signatoryTitle": "",
            "noticeAddress": "",
        }

    def test_clips_a_reply_too_long_to_send_back(self) -> None:
        """
        The transcript is resent every turn, so an over-long reply is not one
        bad message — it is every future message, failing validation.
        """
        turn = run_turn(
            "pilot-agreement",
            {},
            HELLO,
            "key",
            completion({"reply": "x" * (MAX_REPLY + 500) + "?", "patch": {}}),
        )

        assert len(turn.reply) <= MAX_REPLY

    def test_retries_once_before_giving_up(self) -> None:
        attempts = {"count": 0}
        good = completion({"reply": "Recovered. What next?", "patch": {}})

        def flaky(**kwargs):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise ValueError("malformed")
            return good(**kwargs)

        turn = run_turn("pilot-agreement", {}, HELLO, "key", flaky)

        assert attempts["count"] == 2
        assert turn.reply == "Recovered. What next?"

    def test_gives_up_after_the_second_failure(self) -> None:
        def always_fails(**kwargs):
            raise ValueError("malformed")

        with pytest.raises(LlmUnavailable):
            run_turn("pilot-agreement", {}, HELLO, "key", always_fails)


class TestTheSchemaAskedOfTheModel:
    def test_covers_exactly_the_document_s_fields(self) -> None:
        model = draft_model("pilot-agreement")
        patch = model.model_json_schema()["$defs"]

        properties = model.model_fields["patch"].annotation.model_fields
        document = catalog()["pilot-agreement"]
        assert set(properties) == {field.key for field in document.fields}
        assert patch  # nested party/term models are defined, not inlined

    def test_a_term_field_offers_only_its_two_choices(self) -> None:
        """
        The model is shown an enum of the two names rather than a free string,
        so "3 years" cannot arrive as a kind nobody defined.
        """
        definitions = draft_model("mutual-nda").model_json_schema()["$defs"]
        term = next(
            schema
            for name, schema in definitions.items()
            if name.endswith("MndatermDraft")
        )

        assert term["properties"]["kind"]["anyOf"][0]["enum"] == [
            "expires",
            "untilTerminated",
        ]

    def test_is_built_once_per_document(self) -> None:
        assert draft_model("pilot-agreement") is draft_model("pilot-agreement")
        assert draft_model("pilot-agreement") is not draft_model("mutual-nda")


class TestThePrompt:
    def test_names_the_document_and_its_fields(self) -> None:
        document = catalog()["pilot-agreement"]
        prompt = drafting_prompt(document, date(2026, 7, 26))

        assert "Pilot Agreement" in prompt
        for field in document.fields:
            assert field.key in prompt

    def test_marks_which_fields_are_required(self) -> None:
        prompt = drafting_prompt(catalog()["pilot-agreement"], date(2026, 7, 26))

        assert "pilotPeriod (required" in prompt
        assert "generalCapAmount (optional" in prompt

    def test_tells_the_model_not_to_ask_about_a_defaulted_field(self) -> None:
        prompt = drafting_prompt(catalog()["mutual-nda"], date(2026, 7, 26))

        purpose = next(line for line in prompt.splitlines() if line.startswith("- purpose"))
        assert "do not ask" in purpose

    def test_says_which_document_a_document_attaches_to(self) -> None:
        prompt = drafting_prompt(catalog()["service-level-agreement"], date(2026, 7, 26))
        assert "Cloud Service Agreement" in prompt

    def test_carries_todays_date(self) -> None:
        prompt = drafting_prompt(catalog()["pilot-agreement"], date(2026, 7, 26))
        assert "2026-07-26" in prompt

    def test_sends_the_state_rather_than_trusting_the_models_memory(self) -> None:
        document = catalog()["pilot-agreement"]
        state = normalise(document, {"pilotPeriod": "60 days"})

        messages = build_messages("instructions", HELLO, state)

        assert messages[0]["role"] == "system"
        assert "60 days" in messages[0]["content"]
        assert messages[1] == {"role": "user", "content": "hello"}

    def test_omits_the_state_when_choosing_a_document(self) -> None:
        messages = build_messages(selection_prompt(), HELLO)
        assert len(messages) == 2


class TestLeavingSomethingToAnswer:
    """
    Rule 4 of the prompt asks the model to end on a question. This is the part
    that does not depend on it obliging: a conversation is the only way to fill
    the document in, so a reply that stops is a dead end.
    """

    def test_adds_a_question_when_the_reply_has_none(self) -> None:
        document = catalog()["pilot-agreement"]

        reply = ensure_follow_up("Noted.", document, normalise(document, {}))

        assert reply.endswith("?")
        assert "Noted." in reply

    def test_leaves_a_reply_that_already_asks_something(self) -> None:
        document = catalog()["pilot-agreement"]

        reply = ensure_follow_up(
            "Got it. Who signs for the customer?", document, normalise(document, {})
        )

        assert reply == "Got it. Who signs for the customer?"

    def test_says_nothing_extra_once_the_document_is_finished(self) -> None:
        document = catalog()["pilot-agreement"]
        answered = {
            field.key: (
                {
                    "companyName": "Acme",
                    "signatoryName": "Dana Lee",
                    "signatoryTitle": "CEO",
                    "noticeAddress": "legal@acme.test",
                }
                if field.type == "party"
                else "2026-08-01"
                if field.type == "date"
                else "something"
            )
            for field in document.fields
        }

        reply = ensure_follow_up("That's everything.", document, answered)

        assert reply == "That's everything."

    def test_asks_about_the_next_field_still_needed(self) -> None:
        document = catalog()["pilot-agreement"]
        state = normalise(document, {})
        state["provider"] = {
            "companyName": "Acme",
            "signatoryName": "Dana Lee",
            "signatoryTitle": "CEO",
            "noticeAddress": "legal@acme.test",
        }

        reply = ensure_follow_up("Noted.", document, state)

        assert "the company trying the product" in reply

    def test_applies_to_a_real_turn(self) -> None:
        turn = run_turn(
            "pilot-agreement",
            {},
            HELLO,
            "key",
            completion({"reply": "Recorded.", "patch": {"pilotPeriod": "60 days"}}),
        )

        assert turn.reply.endswith("?")

    def test_counts_the_patch_it_just_applied(self) -> None:
        """
        The nudge is computed after the merge, so it cannot ask for something
        the same turn just filled in.
        """
        document = catalog()["pilot-agreement"]
        state = normalise(document, {})
        for key in ("customer", "provider"):
            state[key] = {
                "companyName": "Acme",
                "signatoryName": "Dana Lee",
                "signatoryTitle": "CEO",
                "noticeAddress": "legal@acme.test",
            }
        state["governingLaw"] = "Delaware"
        state["chosenCourts"] = "New Castle, DE"

        turn = run_turn(
            "pilot-agreement",
            state,
            HELLO,
            "key",
            completion({"reply": "Recorded.", "patch": {"pilotPeriod": "60 days"}}),
        )

        assert "how long the pilot runs" not in turn.reply
