"""
Reading a Common Paper template.

Half of these tests are about a grammar; the other half guard the contract text
itself. An accidental change to the parser would ship altered legal language to
whoever signs the output, and no amount of UI testing would notice — so the
whole corpus is parsed here and checked for anything lost or leaked.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.config import REPO_ROOT
from app.documents.parse import (
    canonical_key,
    parse_template,
    strip_possessive,
    variable_names,
)

TEMPLATES = REPO_ROOT / "templates"

# The Mutual NDA is not compiled from its template: it keeps the verbatim
# transcription and fidelity test it shipped with. Its cover page is a form,
# not standard terms, and matches no part of this grammar.
PARSED_TEMPLATES = sorted(
    path for path in TEMPLATES.glob("*.md") if not path.name.startswith("mutual-nda")
)

TAG = re.compile(r"</?span[^>]*>")


def write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "example.md"
    path.write_text(body, encoding="utf-8")
    return path


def flatten(clause) -> str:
    return "".join(segment.text for segment in clause.segments)


class TestTheGrammar:
    def test_reads_the_title(self, tmp_path: Path) -> None:
        path = write(tmp_path, '# Pilot Agreement\n\n1. <span class="header_2" id="1">Access</span>\n')
        assert parse_template(path).title == "Pilot Agreement"

    def test_numbers_clauses_by_their_position(self, tmp_path: Path) -> None:
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span class="header_3" id="1.1">First.</span>  Body.\n'
            '    2. <span class="header_3" id="1.2">Second.</span>  Body.\n'
            "        a. Sub-point.\n"
            "2. <span class=\"header_2\" id=\"2\">Two</span>\n",
        )

        numbers = [clause.number for clause in parse_template(path).clauses]
        assert numbers == ["1", "1.1", "1.2", "1.2.a", "2"]

    def test_records_depth_from_the_indent(self, tmp_path: Path) -> None:
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span class="header_3" id="1.1">First.</span>  Body.\n'
            "        a. Sub-point.\n",
        )

        assert [clause.depth for clause in parse_template(path).clauses] == [0, 1, 2]

    def test_strips_the_trailing_period_from_a_heading(self, tmp_path: Path) -> None:
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span class="header_3" id="1.1">Access and Use.</span>  Body.\n',
        )

        assert parse_template(path).clauses[1].heading == "Access and Use"

    def test_a_bare_anchor_is_not_a_heading(self, tmp_path: Path) -> None:
        """
        The anchor often wraps the opening word of the sentence — `<span
        id="11.1">Except</span> for the limited licence...`. Reading it as a
        heading would delete that word from the agreement.
        """
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span id="1.1">Except</span> as provided below, the Product is fine.\n',
        )

        clause = parse_template(path).clauses[1]
        assert clause.heading is None
        assert flatten(clause).startswith("Except as provided below")

    def test_rejects_a_line_that_is_not_a_list_item(self, tmp_path: Path) -> None:
        path = write(tmp_path, "# Example\n\nA loose paragraph.\n")
        with pytest.raises(ValueError, match="not a list item"):
            parse_template(path)

    def test_rejects_a_template_with_no_title(self, tmp_path: Path) -> None:
        path = write(tmp_path, '1. <span class="header_2" id="1">One</span>\n')
        with pytest.raises(ValueError, match="no `# Title`"):
            parse_template(path)


class TestVariables:
    def test_finds_a_variable_and_keeps_the_words_around_it(
        self, tmp_path: Path
    ) -> None:
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span id="1.1"></span>During the '
            '<span class="orderform_link">Pilot Period</span> the Product is available.\n',
        )

        segments = parse_template(path).clauses[1].segments
        assert [(s.kind, s.text, s.key) for s in segments] == [
            ("text", "During the ", None),
            ("variable", "Pilot Period", "pilotPeriod"),
            ("text", " the Product is available.", None),
        ]

    def test_a_possessive_is_the_same_variable(self, tmp_path: Path) -> None:
        """Both apostrophes appear in the corpus, straight and curly."""
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span id="1.1"></span><span class="orderform_link">Customer</span> and '
            "<span class=\"orderform_link\">Customer's</span> and "
            '<span class="orderform_link">Customer’s</span>.\n',
        )

        parsed = parse_template(path)
        keys = {s.key for s in parsed.clauses[1].segments if s.kind == "variable"}
        assert keys == {"customer"}

    def test_a_possessive_keeps_its_own_wording_on_the_page(
        self, tmp_path: Path
    ) -> None:
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span id="1.1"></span>on <span class="orderform_link">Customer\'s</span> behalf.\n',
        )

        variable = next(
            s for s in parse_template(path).clauses[1].segments if s.kind == "variable"
        )
        assert variable.text == "Customer's"
        assert variable.key == "customer"

    def test_a_plural_folds_into_a_singular_that_also_appears(
        self, tmp_path: Path
    ) -> None:
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span id="1.1"></span>the <span class="orderform_link">Subscription Period</span> '
            'and later <span class="orderform_link">Subscription Periods</span>.\n',
        )

        parsed = parse_template(path)
        assert set(parsed.variables) == {"subscriptionPeriod"}
        assert set(variable_names(path)) == {"subscriptionPeriod"}

    def test_a_plural_with_no_singular_stays_as_written(self, tmp_path: Path) -> None:
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span id="1.1"></span>the <span class="keyterms_link">Approved Subprocessors</span>.\n',
        )

        assert set(parse_template(path).variables) == {"approvedSubprocessors"}

    def test_records_which_clauses_cite_each_variable(self, tmp_path: Path) -> None:
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span id="1.1"></span>the <span class="orderform_link">Pilot Period</span>.\n'
            '    2. <span id="1.2"></span>during the <span class="orderform_link">Pilot Period</span>.\n',
        )

        assert parse_template(path).variables["pilotPeriod"] == ["1.1", "1.2"]

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("Pilot Period", "pilotPeriod"),
            ("SOW Term", "sowTerm"),
            ("DPA", "dpa"),
            ("Non-Renewal Notice Date", "nonRenewalNoticeDate"),
        ],
    )
    def test_builds_a_camel_case_key(self, name: str, expected: str) -> None:
        assert canonical_key(name) == expected

    def test_strips_either_apostrophe(self) -> None:
        assert strip_possessive("Customer's") == "Customer"
        assert strip_possessive("Customer’s") == "Customer"
        assert strip_possessive("Customer") == "Customer"


class TestEmphasis:
    def test_bold_survives_a_variable_in_the_middle_of_it(
        self, tmp_path: Path
    ) -> None:
        """
        The liability caps are written as bold running *around* the value. A
        paired match would find no bold there and drop the emphasis — and on a
        conspicuous-disclaimer clause the emphasis is the operative part.
        """
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span id="1.1"></span>**Liability is capped at the '
            '<span class="orderform_link">General Cap Amount</span>.**\n',
        )

        segments = parse_template(path).clauses[1].segments
        assert all(segment.strong for segment in segments)
        assert [s.kind for s in segments] == ["text", "variable", "text"]

    def test_plain_text_is_not_marked(self, tmp_path: Path) -> None:
        path = write(
            tmp_path,
            "# Example\n"
            '1. <span class="header_2" id="1">One</span>\n'
            '    1. <span id="1.1"></span>Ordinary wording.\n',
        )

        assert not any(s.strong for s in parse_template(path).clauses[1].segments)


class TestTheWholeCorpus:
    """
    Guards the contract text. If one of these fails, read the template before
    touching the expectation — it is a question about legal language.
    """

    def test_every_template_parses(self) -> None:
        assert len(PARSED_TEMPLATES) == 10
        for path in PARSED_TEMPLATES:
            assert parse_template(path).clauses

    @pytest.mark.parametrize("path", PARSED_TEMPLATES, ids=lambda p: p.stem)
    def test_no_markup_reaches_the_page(self, path: Path) -> None:
        for clause in parse_template(path).clauses:
            body = flatten(clause)
            for leaked in ("<span", "</span", "**", "](", "<http"):
                assert leaked not in body, f"{path.name} {clause.number}: {leaked}"

    @pytest.mark.parametrize("path", PARSED_TEMPLATES, ids=lambda p: p.stem)
    def test_no_word_of_the_source_is_lost(self, path: Path) -> None:
        """
        The check that would have caught the bare-anchor bug: reading `<span
        id="11.1">Except</span>` as a heading silently dropped "Except" from
        the clause.
        """
        parsed = parse_template(path)
        source = TAG.sub("", path.read_text(encoding="utf-8")).replace("**", "")

        rendered = " ".join(
            flatten(clause) + " " + (clause.heading or "") for clause in parsed.clauses
        )
        rendered += " " + parsed.title

        lost = set(re.findall(r"[A-Za-z]{4,}", source)) - set(
            re.findall(r"[A-Za-z]{4,}", rendered)
        )
        assert not lost, f"{path.name} lost: {sorted(lost)}"

    @pytest.mark.parametrize("path", PARSED_TEMPLATES, ids=lambda p: p.stem)
    def test_every_variable_resolves_to_a_key(self, path: Path) -> None:
        parsed = parse_template(path)
        known = set(variable_names(path))

        for clause in parsed.clauses:
            for segment in clause.segments:
                if segment.kind == "variable":
                    assert segment.key in known
