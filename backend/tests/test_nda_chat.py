"""
The drafting turn, without a model.

`merge_patch` is where an untrusted answer becomes a term of an agreement, so
most of this file is about what it refuses.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.llm import LlmUnavailable
from app.nda_chat import (
    ChatMessage,
    ConfidentialityTerm,
    ConfidentialityTermDraft,
    CoverPage,
    CoverPageDraft,
    LlmTurn,
    MAX_REPLY,
    MndaTerm,
    MndaTermDraft,
    Party,
    PartyDraft,
    build_messages,
    merge_patch,
    run_turn,
)


def cover_page(**overrides: object) -> CoverPage:
    """A part-filled agreement: two named parties, no governing law yet."""
    defaults: dict[str, object] = {
        "purpose": "Evaluating a business relationship.",
        "effective_date": "2026-07-26",
        "mnda_term": MndaTerm(kind="expires", years=2),
        "confidentiality_term": ConfidentialityTerm(kind="years", years=3),
        "party_one": Party(
            company_name="Northwind Labs, Inc.",
            signatory_name="Dana Reyes",
            signatory_title="Chief Executive Officer",
            notice_address="legal@northwindlabs.com",
        ),
    }
    return CoverPage.model_validate(defaults | overrides)


class TestAcceptedValues:
    def test_takes_a_plain_answer(self) -> None:
        patch = merge_patch(cover_page(), CoverPageDraft(governing_law="Delaware"))
        assert patch.governing_law == "Delaware"

    def test_trims_surrounding_space(self) -> None:
        patch = merge_patch(cover_page(), CoverPageDraft(governing_law="  Delaware "))
        assert patch.governing_law == "Delaware"

    def test_leaves_unmentioned_fields_out_entirely(self) -> None:
        patch = merge_patch(cover_page(), CoverPageDraft(governing_law="Delaware"))
        assert patch.jurisdiction is None
        assert patch.purpose is None
        assert patch.party_one is None

    def test_normalises_a_date(self) -> None:
        patch = merge_patch(cover_page(), CoverPageDraft(effective_date=" 2026-08-01 "))
        assert patch.effective_date == "2026-08-01"


class TestRejectedValues:
    """Each of these costs one field, never the whole turn."""

    def test_drops_a_blank_answer(self) -> None:
        patch = merge_patch(cover_page(), CoverPageDraft(governing_law="   "))
        assert patch.governing_law is None

    def test_a_blank_never_clears_an_existing_answer(self) -> None:
        patch = merge_patch(
            cover_page(modifications="Section 5 is amended."),
            CoverPageDraft(modifications=""),
        )
        assert patch.modifications is None

    def test_drops_an_answer_too_long_to_be_one(self) -> None:
        patch = merge_patch(cover_page(), CoverPageDraft(governing_law="x" * 301))
        assert patch.governing_law is None

    def test_keeps_the_rest_of_the_turn_when_one_field_fails(self) -> None:
        patch = merge_patch(
            cover_page(),
            CoverPageDraft(governing_law="x" * 301, jurisdiction="New Castle, DE"),
        )
        assert patch.governing_law is None
        assert patch.jurisdiction == "New Castle, DE"

    @pytest.mark.parametrize("bad", ["not a date", "2026-13-01", "26/07/2026", ""])
    def test_drops_a_date_that_is_not_one(self, bad: str) -> None:
        patch = merge_patch(cover_page(), CoverPageDraft(effective_date=bad))
        assert patch.effective_date is None

    @pytest.mark.parametrize("bad", ["1799-01-01", "2500-01-01"])
    def test_drops_a_date_outside_living_memory_or_reach(self, bad: str) -> None:
        patch = merge_patch(cover_page(), CoverPageDraft(effective_date=bad))
        assert patch.effective_date is None

    @pytest.mark.parametrize("bad", [0, -3, 100])
    def test_drops_a_term_length_no_agreement_could_have(self, bad: int) -> None:
        patch = merge_patch(
            cover_page(), CoverPageDraft(mnda_term=MndaTermDraft(kind="expires", years=bad))
        )
        assert patch.mnda_term is None

    def test_rejects_a_boolean_as_a_year_count(self) -> None:
        """`True` is an `int` in Python, and is not a term length."""
        draft = MndaTermDraft.model_construct(kind="expires", years=True)
        patch = merge_patch(cover_page(), CoverPageDraft(mnda_term=draft))
        assert patch.mnda_term is None


class TestParties:
    def test_keeps_the_fields_the_model_did_not_mention(self) -> None:
        """
        The frontend merges a party wholesale, so a partial one would blank the
        rest. This is the single most damaging thing a patch could get wrong.
        """
        patch = merge_patch(
            cover_page(), CoverPageDraft(party_one=PartyDraft(signatory_title="President"))
        )
        assert patch.party_one is not None
        assert patch.party_one.signatory_title == "President"
        assert patch.party_one.company_name == "Northwind Labs, Inc."
        assert patch.party_one.signatory_name == "Dana Reyes"
        assert patch.party_one.notice_address == "legal@northwindlabs.com"

    def test_fills_an_empty_party_from_nothing(self) -> None:
        patch = merge_patch(
            cover_page(), CoverPageDraft(party_two=PartyDraft(company_name="Kestrel LLC"))
        )
        assert patch.party_two is not None
        assert patch.party_two.company_name == "Kestrel LLC"
        assert patch.party_two.signatory_name == ""

    def test_omits_a_party_whose_every_field_was_unusable(self) -> None:
        patch = merge_patch(
            cover_page(), CoverPageDraft(party_one=PartyDraft(company_name="  "))
        )
        assert patch.party_one is None


class TestTerms:
    def test_reads_a_bare_year_count_as_expiry(self) -> None:
        patch = merge_patch(cover_page(), CoverPageDraft(mnda_term=MndaTermDraft(years=5)))
        assert patch.mnda_term == MndaTerm(kind="expires", years=5)

    def test_switches_to_the_open_ended_choice(self) -> None:
        patch = merge_patch(
            cover_page(), CoverPageDraft(mnda_term=MndaTermDraft(kind="untilTerminated"))
        )
        assert patch.mnda_term == MndaTerm(kind="untilTerminated", years=None)

    def test_switching_back_keeps_the_length_already_agreed(self) -> None:
        patch = merge_patch(
            cover_page(), CoverPageDraft(mnda_term=MndaTermDraft(kind="expires"))
        )
        assert patch.mnda_term == MndaTerm(kind="expires", years=2)

    def test_drops_an_expiry_with_no_length_anywhere(self) -> None:
        """Half a discriminated union is not a state the agreement can be in."""
        current = cover_page(mnda_term=MndaTerm(kind="untilTerminated", years=None))
        patch = merge_patch(current, CoverPageDraft(mnda_term=MndaTermDraft(kind="expires")))
        assert patch.mnda_term is None

    def test_drops_a_term_that_says_nothing(self) -> None:
        patch = merge_patch(cover_page(), CoverPageDraft(mnda_term=MndaTermDraft()))
        assert patch.mnda_term is None

    def test_confidentiality_follows_the_same_rules(self) -> None:
        patch = merge_patch(
            cover_page(),
            CoverPageDraft(confidentiality_term=ConfidentialityTermDraft(kind="perpetuity")),
        )
        assert patch.confidentiality_term == ConfidentialityTerm(
            kind="perpetuity", years=None
        )

    def test_reads_a_bare_confidentiality_count_as_years(self) -> None:
        patch = merge_patch(
            cover_page(),
            CoverPageDraft(confidentiality_term=ConfidentialityTermDraft(years=7)),
        )
        assert patch.confidentiality_term == ConfidentialityTerm(kind="years", years=7)


class TestPrompt:
    def test_states_what_is_already_known(self) -> None:
        messages = build_messages(cover_page(), [], today=date(2026, 7, 26))
        assert "Northwind Labs, Inc." in messages[0]["content"]

    def test_names_fields_the_way_the_wire_does(self) -> None:
        """The prompt and the schema must agree on what a field is called."""
        system = build_messages(cover_page(), [], today=date(2026, 7, 26))[0]["content"]
        assert "effectiveDate" in system
        assert "effective_date" not in system

    def test_supplies_today_for_anything_said_relative_to_it(self) -> None:
        system = build_messages(cover_page(), [], today=date(2026, 7, 26))[0]["content"]
        assert "2026-07-26" in system

    def test_carries_the_transcript_after_the_instructions(self) -> None:
        history = [
            ChatMessage(role="user", content="Delaware."),
            ChatMessage(role="assistant", content="Got it."),
        ]
        messages = build_messages(cover_page(), history, today=date(2026, 7, 26))
        assert [message["role"] for message in messages] == [
            "system",
            "user",
            "assistant",
        ]
        assert messages[1]["content"] == "Delaware."


class TestRunTurn:
    def _completion(self, turn: LlmTurn):
        """A stand-in for `litellm.completion` that answers with `turn`."""

        class Message:
            content = turn.model_dump_json(by_alias=True)

        class Choice:
            message = Message()

        class Response:
            choices = [Choice()]

            def __init__(self, **kwargs: object) -> None:
                pass

        return Response

    def test_returns_the_reply_and_the_merged_patch(self) -> None:
        turn = LlmTurn(
            reply="  Got it — Delaware it is.  ",
            patch=CoverPageDraft(governing_law="Delaware"),
        )
        reply, patch = run_turn(
            cover_page(), [ChatMessage(role="user", content="Delaware")], "key", self._completion(turn)
        )
        assert reply == "Got it — Delaware it is."
        assert patch.governing_law == "Delaware"

    def test_clips_a_reply_too_long_to_send_back(self) -> None:
        """
        The transcript is resent every turn, so an over-long reply is not one
        bad message — it is every message after it, rejected by the request
        model, until it falls out of the window.
        """
        turn = LlmTurn(reply="x" * 5000, patch=CoverPageDraft())
        reply, _ = run_turn(
            cover_page(), [ChatMessage(role="user", content="hi")], "key", self._completion(turn)
        )
        assert len(reply) == MAX_REPLY

    def test_retries_once_before_giving_up(self) -> None:
        """A single malformed response should not cost the user their message."""
        good = self._completion(LlmTurn(reply="Fine.", patch=CoverPageDraft()))
        calls: list[int] = []

        def flaky(**kwargs: object):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("provider hiccup")
            return good()

        reply, _ = run_turn(
            cover_page(), [ChatMessage(role="user", content="hi")], "key", flaky
        )
        assert reply == "Fine."
        assert len(calls) == 2

    def test_gives_up_after_the_second_failure(self) -> None:
        def always_fails(**kwargs: object):
            raise RuntimeError("provider is down")

        with pytest.raises(LlmUnavailable):
            run_turn(
                cover_page(), [ChatMessage(role="user", content="hi")], "key", always_fails
            )
