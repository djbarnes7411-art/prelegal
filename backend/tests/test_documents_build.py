"""
Compiling definitions and templates into the catalog both halves read.

The test that matters most here is the first one: the generated files are
committed, and a stale commit would mean the browser and the backend disagreeing
with the definitions about what a document contains.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.documents import build
from app.documents.build import DefinitionError, compile_document, main


class TestTheCommittedOutput:
    def test_is_current(self) -> None:
        """
        If this fails, run:

            cd backend && uv run python -m app.documents.build
        """
        assert main(["--check"]) == 0

    def test_every_catalogued_document_has_a_definition(self) -> None:
        from app.documents.catalog import catalog

        slugs = set(catalog())
        assert len(slugs) == 11
        assert "mutual-nda" in slugs

    def test_clause_text_is_not_in_the_catalog(self) -> None:
        """
        The backend builds prompts from field definitions and never reads
        contract prose. Keeping the two apart is what lets the browser fetch one
        agreement's text instead of eleven.
        """
        import json

        payload = json.loads(build.CATALOG_PATH.read_text(encoding="utf-8"))
        for document in payload["documents"]:
            assert "clauses" not in document

    def test_a_clause_file_exists_for_every_generic_document(self) -> None:
        from app.documents.catalog import catalog

        for document in catalog().values():
            path = build.CLAUSES_DIR / f"{document.slug}.json"
            assert path.is_file() == (document.renderer == "generic"), document.slug


def definition(tmp_path: Path, body: str, template: str | None = None) -> Path:
    """A definition file, optionally alongside a tiny template of its own."""
    if template is not None:
        (tmp_path / "example.md").write_text(template, encoding="utf-8")
    path = tmp_path / "example.toml"
    path.write_text(body, encoding="utf-8")
    return path


TEMPLATE = (
    "# Example\n"
    '1. <span class="header_2" id="1">One</span>\n'
    '    1. <span id="1.1"></span>During the '
    '<span class="orderform_link">Pilot Period</span>, '
    '<span class="orderform_link">Customer</span> may use it.\n'
)

COMPLETE = """
slug = "example"
name = "Example"
summary = "An example."
template = "example.md"

[fields.pilotPeriod]
type = "text"
label = "how long it runs"
required = true

[fields.customer]
type = "party"
label = "the customer"
required = true
"""


@pytest.fixture
def local_repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Resolves a definition's `template` path against the fixture directory."""
    monkeypatch.setattr(build, "REPO_ROOT", tmp_path)
    return tmp_path


class TestCheckingADefinitionAgainstItsTemplate:
    def test_accepts_a_definition_that_accounts_for_every_variable(
        self, local_repo: Path
    ) -> None:
        path = definition(local_repo, COMPLETE, TEMPLATE)
        compiled = compile_document(path)

        assert {field["key"] for field in compiled["fields"]} == {
            "pilotPeriod",
            "customer",
        }

    def test_refuses_a_variable_with_no_definition(self, local_repo: Path) -> None:
        """
        Otherwise the contract would carry a blank nobody could ever fill in:
        the assistant is never told the field exists.
        """
        missing_customer = COMPLETE.replace(
            '\n[fields.customer]\ntype = "party"\nlabel = "the customer"\nrequired = true\n',
            "\n",
        )
        path = definition(local_repo, missing_customer, TEMPLATE)

        with pytest.raises(DefinitionError, match="undefined variables"):
            compile_document(path)

    def test_refuses_a_definition_for_a_variable_the_template_never_cites(
        self, local_repo: Path
    ) -> None:
        """Otherwise the assistant asks a question that changes nothing."""
        body = COMPLETE + '\n[fields.targetUptime]\ntype = "text"\nrequired = false\n'
        path = definition(local_repo, body, TEMPLATE)

        with pytest.raises(DefinitionError, match="never cites"):
            compile_document(path)

    def test_records_which_clauses_each_field_reaches(self, local_repo: Path) -> None:
        path = definition(local_repo, COMPLETE, TEMPLATE)
        compiled = compile_document(path)

        pilot = next(f for f in compiled["fields"] if f["key"] == "pilotPeriod")
        assert pilot["clauses"] == ["1.1"]


class TestRejectingABadDefinition:
    @pytest.mark.parametrize(
        ("body", "message"),
        [
            ('name = "x"\nsummary = "y"\n[fields.a]\ntype="text"\n', "slug"),
            ('slug = "x"\nsummary = "y"\n[fields.a]\ntype="text"\n', "name"),
            ('slug = "x"\nname = "y"\n[fields.a]\ntype="text"\n', "summary"),
        ],
    )
    def test_requires_the_catalog_details(
        self, local_repo: Path, body: str, message: str
    ) -> None:
        with pytest.raises(DefinitionError, match=message):
            compile_document(definition(local_repo, body))

    def test_requires_at_least_one_field(self, local_repo: Path) -> None:
        body = 'slug = "x"\nname = "y"\nsummary = "z"\n'
        with pytest.raises(DefinitionError, match="no \\[fields\\] table"):
            compile_document(definition(local_repo, body))

    def test_requires_a_known_field_type(self, local_repo: Path) -> None:
        body = (
            'slug="x"\nname="y"\nsummary="z"\nrenderer="mutual-nda"\n'
            '[fields.a]\ntype="postcode"\nrequired=true\n'
        )
        with pytest.raises(DefinitionError, match="unknown type"):
            compile_document(definition(local_repo, body))

    def test_requires_something_to_be_required(self, local_repo: Path) -> None:
        """A document with no required field could never be reported as finished."""
        body = (
            'slug="x"\nname="y"\nsummary="z"\nrenderer="mutual-nda"\n'
            '[fields.a]\ntype="text"\nrequired=false\n'
        )
        with pytest.raises(DefinitionError, match="never finishable"):
            compile_document(definition(local_repo, body))

    def test_requires_a_term_to_name_both_of_its_choices(
        self, local_repo: Path
    ) -> None:
        body = (
            'slug="x"\nname="y"\nsummary="z"\nrenderer="mutual-nda"\n'
            '[fields.a]\ntype="term"\nrequired=true\n'
        )
        with pytest.raises(DefinitionError, match="needs a"):
            compile_document(definition(local_repo, body))

    def test_requires_a_definition_without_a_template_to_say_why(
        self, local_repo: Path
    ) -> None:
        """Only the Mutual NDA is exempt, and it has to declare itself as such."""
        body = 'slug="x"\nname="y"\nsummary="z"\n[fields.a]\ntype="text"\nrequired=true\n'
        with pytest.raises(DefinitionError, match="renderer = 'mutual-nda'"):
            compile_document(definition(local_repo, body))

    def test_refuses_a_key_that_is_not_a_usable_identifier(
        self, local_repo: Path
    ) -> None:
        """
        The key becomes a Pydantic attribute, a JSON property and a state key.
        A name that cannot be all three has to fail here rather than at the
        first chat turn.
        """
        body = (
            'slug="x"\nname="y"\nsummary="z"\nrenderer="mutual-nda"\n'
            '[fields."30DayPeriod"]\ntype="text"\nrequired=true\nvariable="30 Day Period"\n'
        )
        with pytest.raises(DefinitionError, match="not a valid identifier"):
            compile_document(definition(local_repo, body))

    def test_refuses_a_default_on_a_field_that_cannot_take_one(
        self, local_repo: Path
    ) -> None:
        body = (
            'slug="x"\nname="y"\nsummary="z"\nrenderer="mutual-nda"\n'
            '[fields.a]\ntype="party"\nrequired=true\ndefault="Acme"\n'
        )
        with pytest.raises(DefinitionError, match="cannot take a 'default'"):
            compile_document(definition(local_repo, body))

    def test_refuses_a_date_default_that_is_not_today(self, local_repo: Path) -> None:
        """
        The only date a document can sensibly start with is the reader's own,
        and that is resolved in the browser.
        """
        body = (
            'slug="x"\nname="y"\nsummary="z"\nrenderer="mutual-nda"\n'
            '[fields.a]\ntype="date"\nrequired=true\ndefault="2026-01-01"\n'
        )
        with pytest.raises(DefinitionError, match='must be "today"'):
            compile_document(definition(local_repo, body))
