"""
The trust boundary.

`merge_patch` is the only route from a model's output to an agreement, so these
tests are the specification of what a model is allowed to change and what
happens when it says something unusable. Read them before changing that module.
"""

from __future__ import annotations

import pytest

from app.documents.catalog import Document, Field, catalog
from app.documents.values import (
    MAX_LONG,
    MAX_SHORT,
    empty_party,
    is_answered,
    merge_patch,
    missing_required,
    normalise,
)

PILOT = "pilot-agreement"
NDA = "mutual-nda"


@pytest.fixture
def pilot() -> Document:
    return catalog()[PILOT]


@pytest.fixture
def nda() -> Document:
    return catalog()[NDA]


def party(**overrides: str) -> dict[str, str]:
    return {**empty_party(), **overrides}


class TestAcceptingAnAnswer:
    def test_takes_a_plain_value(self, pilot: Document) -> None:
        patch = merge_patch(pilot, {}, {"pilotPeriod": "60 days"})
        assert patch == {"pilotPeriod": "60 days"}

    def test_trims_surrounding_space(self, pilot: Document) -> None:
        patch = merge_patch(pilot, {}, {"pilotPeriod": "  60 days \n"})
        assert patch == {"pilotPeriod": "60 days"}

    def test_takes_an_iso_date(self, pilot: Document) -> None:
        patch = merge_patch(pilot, {}, {"effectiveDate": "2026-08-01"})
        assert patch == {"effectiveDate": "2026-08-01"}

    def test_ignores_a_field_the_document_does_not_have(self, pilot: Document) -> None:
        assert merge_patch(pilot, {}, {"targetUptime": "99.9%"}) == {}

    def test_a_field_the_model_did_not_mention_is_absent(self, pilot: Document) -> None:
        """
        Absent, not null. The browser merges shallowly, so a null would land as
        a real value and blank whatever was already agreed.
        """
        patch = merge_patch(pilot, {}, {"pilotPeriod": "60 days"})
        assert "governingLaw" not in patch


class TestRejectingAnAnswer:
    def test_drops_a_date_that_is_not_one(self, pilot: Document) -> None:
        assert merge_patch(pilot, {}, {"effectiveDate": "next Tuesday"}) == {}

    def test_drops_a_date_outside_the_plausible_range(self, pilot: Document) -> None:
        assert merge_patch(pilot, {}, {"effectiveDate": "1682-08-01"}) == {}

    def test_drops_an_over_long_value_rather_than_truncating_it(
        self, pilot: Document
    ) -> None:
        """
        Half a company name printed on a signature block reads as a real answer.
        Asking again is the honest outcome.
        """
        assert merge_patch(pilot, {}, {"pilotPeriod": "x" * (MAX_SHORT + 1)}) == {}

    def test_allows_a_paragraph_in_a_long_field(self, nda: Document) -> None:
        long_but_allowed = "x" * (MAX_SHORT + 1)
        patch = merge_patch(nda, {}, {"modifications": long_but_allowed})
        assert patch == {"modifications": long_but_allowed}

        assert merge_patch(nda, {}, {"modifications": "x" * (MAX_LONG + 1)}) == {}

    def test_drops_a_non_string_value(self, pilot: Document) -> None:
        assert merge_patch(pilot, {}, {"pilotPeriod": 60}) == {}

    def test_one_bad_field_does_not_cost_the_good_ones(self, pilot: Document) -> None:
        """The point of validating per field rather than per turn."""
        patch = merge_patch(
            pilot,
            {},
            {
                "effectiveDate": "whenever",
                "pilotPeriod": "60 days",
                "governingLaw": "Delaware",
            },
        )

        assert patch == {"pilotPeriod": "60 days", "governingLaw": "Delaware"}


class TestABlankNeverClearsAnAnswer:
    def test_an_empty_string_is_ignored(self, pilot: Document) -> None:
        current = {"governingLaw": "Delaware"}
        assert merge_patch(pilot, current, {"governingLaw": ""}) == {}

    def test_whitespace_is_ignored(self, pilot: Document) -> None:
        current = {"governingLaw": "Delaware"}
        assert merge_patch(pilot, current, {"governingLaw": "   "}) == {}

    def test_including_for_an_optional_field(self, nda: Document) -> None:
        """
        A stray blank wiping a negotiated modification is far worse than not
        being able to clear one by chat.
        """
        current = {"modifications": "Clause 5 struck out."}
        assert merge_patch(nda, current, {"modifications": ""}) == {}


class TestPartiesComeBackWhole:
    def test_a_partial_party_is_merged_onto_the_current_one(
        self, pilot: Document
    ) -> None:
        current = {"provider": party(companyName="Acme", signatoryName="Dana Lee")}

        patch = merge_patch(pilot, current, {"provider": {"signatoryTitle": "CEO"}})

        assert patch["provider"] == {
            "companyName": "Acme",
            "signatoryName": "Dana Lee",
            "signatoryTitle": "CEO",
            "noticeAddress": "",
        }

    def test_a_party_with_nothing_usable_is_omitted(self, pilot: Document) -> None:
        current = {"provider": party(companyName="Acme")}
        assert merge_patch(pilot, current, {"provider": {"signatoryName": "  "}}) == {}

    def test_a_bad_field_does_not_lose_the_others(self, pilot: Document) -> None:
        patch = merge_patch(
            pilot,
            {},
            {"provider": {"companyName": "Acme", "signatoryName": "x" * 400}},
        )

        assert patch["provider"]["companyName"] == "Acme"
        assert patch["provider"]["signatoryName"] == ""


class TestTermsAreSettledOrLeftAlone:
    def test_a_counted_term_is_taken_whole(self, nda: Document) -> None:
        patch = merge_patch(nda, {}, {"mndaTerm": {"kind": "expires", "years": 3}})
        assert patch == {"mndaTerm": {"kind": "expires", "years": 3}}

    def test_a_bare_year_count_implies_the_counted_choice(self, nda: Document) -> None:
        patch = merge_patch(nda, {}, {"mndaTerm": {"years": 3}})
        assert patch == {"mndaTerm": {"kind": "expires", "years": 3}}

    def test_the_open_ended_choice_clears_the_years(self, nda: Document) -> None:
        current = {"mndaTerm": {"kind": "expires", "years": 3}}
        patch = merge_patch(nda, current, {"mndaTerm": {"kind": "untilTerminated"}})
        assert patch == {"mndaTerm": {"kind": "untilTerminated", "years": None}}

    def test_switching_back_keeps_the_length_already_agreed(self, nda: Document) -> None:
        current = {"mndaTerm": {"kind": "untilTerminated", "years": 5}}
        patch = merge_patch(nda, current, {"mndaTerm": {"kind": "expires"}})
        assert patch == {"mndaTerm": {"kind": "expires", "years": 5}}

    def test_a_stated_but_unusable_length_drops_the_whole_term(
        self, nda: Document
    ) -> None:
        """
        Substituting the previous number would put a term in the agreement that
        neither party chose.
        """
        current = {"mndaTerm": {"kind": "expires", "years": 3}}
        assert merge_patch(nda, current, {"mndaTerm": {"years": 0}}) == {}
        assert merge_patch(nda, current, {"mndaTerm": {"years": 500}}) == {}

    def test_true_is_not_a_number_of_years(self, nda: Document) -> None:
        """`bool` is an `int` in Python, and `True` years is not a term length."""
        assert merge_patch(nda, {}, {"mndaTerm": {"years": True}}) == {}

    def test_a_term_the_draft_did_not_describe_is_omitted(self, nda: Document) -> None:
        assert merge_patch(nda, {}, {"mndaTerm": {}}) == {}


class TestReadingTheStateTheBrowserSent:
    def test_fills_in_every_field_the_document_has(self, pilot: Document) -> None:
        state = normalise(pilot, {})
        assert set(state) == {field.key for field in pilot.fields}

    def test_drops_fields_the_document_does_not_have(self, pilot: Document) -> None:
        assert "targetUptime" not in normalise(pilot, {"targetUptime": "99.9%"})

    def test_survives_a_value_of_the_wrong_shape(self, pilot: Document) -> None:
        state = normalise(pilot, {"provider": "Acme Inc."})
        assert state["provider"] == empty_party()

    def test_survives_a_body_that_is_not_an_object(self, pilot: Document) -> None:
        assert normalise(pilot, "nonsense") == {}


class TestCountingWhatIsLeft:
    def test_a_party_needs_all_four_of_its_fields(self, pilot: Document) -> None:
        provider = pilot.field("provider")
        assert provider is not None

        assert not is_answered(provider, party(companyName="Acme"))
        assert is_answered(
            provider,
            party(
                companyName="Acme",
                signatoryName="Dana Lee",
                signatoryTitle="CEO",
                noticeAddress="legal@acme.test",
            ),
        )

    def test_the_open_ended_choice_counts_as_answered(self, nda: Document) -> None:
        term = nda.field("mndaTerm")
        assert term is not None
        assert is_answered(term, {"kind": "untilTerminated", "years": None})

    def test_optional_fields_are_never_missing(self, pilot: Document) -> None:
        """
        The standard terms read an omitted value as "none", so a document
        without one is finished, not incomplete.
        """
        missing = missing_required(pilot, normalise(pilot, {}))
        assert all(field.required for field in missing)
        assert "generalCapAmount" not in {field.key for field in missing}

    def test_missing_fields_come_back_in_the_order_they_are_asked(
        self, pilot: Document
    ) -> None:
        missing = [field.key for field in missing_required(pilot, normalise(pilot, {}))]
        assert missing[0] == "provider"
        assert missing[1] == "customer"

    def test_nothing_is_missing_once_everything_is_answered(
        self, pilot: Document
    ) -> None:
        answered = {
            field.key: (
                party(
                    companyName="Acme",
                    signatoryName="Dana Lee",
                    signatoryTitle="CEO",
                    noticeAddress="legal@acme.test",
                )
                if field.type == "party"
                else "2026-08-01"
                if field.type == "date"
                else "something"
            )
            for field in pilot.fields
        }

        assert missing_required(pilot, answered) == []
