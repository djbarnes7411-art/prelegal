"""
The documents this product can draft, as the backend sees them.

Reads the catalog compiled by `app.documents.build` — field definitions, blurbs
and aliases, and nothing else. The clause text lives in separate files the
browser loads; the prompt is built from field definitions, so no part of the
backend needs a word of contract prose.

Loaded once, at import. The catalog is a build artifact that cannot change while
the process runs, and a per-request read would only add a file system call to
every turn.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from ..config import REPO_ROOT

CATALOG_PATH = (
    REPO_ROOT / "frontend" / "lib" / "documents" / "generated" / "catalog.json"
)


@dataclass(frozen=True)
class Field:
    """One fill-in value: what it is called, what it holds, and where it lands."""

    key: str
    name: str
    type: str
    label: str
    required: bool
    clauses: tuple[str, ...]
    hint: str | None = None
    # `term` fields only: the two sides of the either/or. `counted` needs a
    # number of `noun`s; `open_ended` is the alternative that needs no number.
    counted: str | None = None
    open_ended: str | None = None
    noun: str = "year"
    # A starting value the browser seeds. `"today"` on a date field means the
    # reader's own clock.
    default: str | None = None
    default_years: int | None = None

    @property
    def has_default(self) -> bool:
        return self.default is not None or self.default_years is not None


@dataclass(frozen=True)
class Document:
    slug: str
    name: str
    title: str
    summary: str
    aliases: tuple[str, ...]
    attachment: str | None
    renderer: str
    version: str | None
    source_url: str | None
    fields: tuple[Field, ...]

    @property
    def required_fields(self) -> tuple[Field, ...]:
        return tuple(field for field in self.fields if field.required)

    def field(self, key: str) -> Field | None:
        for candidate in self.fields:
            if candidate.key == key:
                return candidate
        return None


def _field(payload: dict) -> Field:
    return Field(
        key=payload["key"],
        name=payload["name"],
        type=payload["type"],
        label=payload["label"],
        required=bool(payload["required"]),
        clauses=tuple(payload.get("clauses", ())),
        hint=payload.get("hint"),
        counted=payload.get("counted"),
        open_ended=payload.get("openEnded"),
        noun=payload.get("noun", "year"),
        default=payload.get("default"),
        default_years=payload.get("defaultYears"),
    )


def _document(payload: dict) -> Document:
    return Document(
        slug=payload["slug"],
        name=payload["name"],
        title=payload["title"],
        summary=payload["summary"],
        aliases=tuple(payload.get("aliases", ())),
        attachment=payload.get("attachment"),
        renderer=payload.get("renderer", "generic"),
        version=payload.get("version"),
        source_url=payload.get("sourceUrl"),
        fields=tuple(_field(field) for field in payload["fields"]),
    )


@cache
def catalog(path: Path | None = None) -> dict[str, Document]:
    """Every document, by slug, in the order the catalog lists them."""
    source = path or CATALOG_PATH
    payload = json.loads(source.read_text(encoding="utf-8"))
    return {
        document["slug"]: _document(document) for document in payload["documents"]
    }


def find(slug: str | None) -> Document | None:
    """The document with this slug, or None — including for a slug we invented."""
    if not slug:
        return None
    return catalog().get(slug)
