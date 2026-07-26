"""
The trust boundary: what the model says, turned into what the document holds.

`merge_patch` is the only route from a model's output to an agreement, which is
why every check lives here. Three rules carried over from the Mutual NDA, all of
them load-bearing:

**A bad field costs that field, not the turn.** One hallucinated year should not
throw away a good reply and four good values alongside it. Every sanitizer
returns None instead of raising, and a dropped field is simply asked about
again — exactly what would have happened had the model never mentioned it.

**Every value handed back is complete.** The browser merges shallowly, so a
party arrives with all four of its fields and a term with both of its own. Half
a party would silently blank whatever the model happened not to mention.

**A blank never clears an answer.** The model omitting a field and the model
sending "" both mean "nothing new here" — including for optional fields, since a
stray blank wiping a negotiated term is far worse than not being able to clear
it by chat.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from .catalog import Document, Field

# Bounds on what the model may write into an agreement. Generous enough for a
# real answer, tight enough that a runaway generation cannot fill a legal
# document with prose nobody asked for.
MAX_SHORT = 300
MAX_LONG = 2000
MIN_YEARS = 1
MAX_YEARS = 99
MIN_YEAR = 1900
MAX_YEAR = 2100

PARTY_PARTS = ("companyName", "signatoryName", "signatoryTitle", "noticeAddress")

# A one-line field gets the short bound; a paragraph field gets the long one.
LIMITS = {
    "text": MAX_SHORT,
    "money": MAX_SHORT,
    "date": MAX_SHORT,
    "longText": MAX_LONG,
}


def clean_text(value: Any, limit: int) -> str | None:
    """
    A usable answer, or nothing.

    Over-long values are dropped rather than truncated: half a company name
    printed on a signature block reads as a real answer, and asking again is the
    honest outcome.
    """
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if not trimmed or len(trimmed) > limit:
        return None
    return trimmed


def clean_years(value: Any) -> int | None:
    """A whole number of years a term can actually be measured in."""
    # bool is an int in Python, and `True` years is not a term length.
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if not MIN_YEARS <= value <= MAX_YEARS:
        return None
    return value


def clean_date(value: Any) -> str | None:
    """An ISO date the agreement could plausibly take effect on."""
    if not isinstance(value, str):
        return None
    try:
        parsed = date.fromisoformat(value.strip())
    except ValueError:
        return None
    if not MIN_YEAR <= parsed.year <= MAX_YEAR:
        return None
    return parsed.isoformat()


def empty_party() -> dict[str, str]:
    return {part: "" for part in PARTY_PARTS}


def normalise(document: Document, fields: Any) -> dict[str, Any]:
    """
    The state the browser sent, reduced to values this document can hold.

    The client's own data comes back every turn, so this is a shape check rather
    than a trust check — but a field the document does not have, or a party that
    arrived as a string, would break the prompt and the merge further down.
    """
    if not isinstance(fields, dict):
        return {}

    state: dict[str, Any] = {}
    for field in document.fields:
        value = fields.get(field.key)

        if field.type == "party":
            given = value if isinstance(value, dict) else {}
            state[field.key] = {
                part: clean_text(given.get(part), MAX_SHORT) or "" for part in PARTY_PARTS
            }
        elif field.type == "term":
            state[field.key] = _normalise_term(field, value)
        else:
            state[field.key] = clean_text(value, LIMITS.get(field.type, MAX_SHORT)) or ""

    return state


def _normalise_term(field: Field, value: Any) -> dict[str, Any]:
    given = value if isinstance(value, dict) else {}
    kind = given.get("kind")
    if kind not in (field.counted, field.open_ended):
        kind = field.counted
    years = clean_years(given.get("years")) if kind == field.counted else None
    return {"kind": kind, "years": years}


def _merge_party(current: Any, draft: Any) -> dict[str, str] | None:
    """The party with the draft's usable fields applied, or None if none were."""
    if not isinstance(draft, dict):
        return None

    accepted = {
        part: cleaned
        for part in PARTY_PARTS
        if (cleaned := clean_text(draft.get(part), MAX_SHORT)) is not None
    }
    if not accepted:
        return None

    merged = dict(current) if isinstance(current, dict) else empty_party()
    merged.update(accepted)
    return {part: merged.get(part, "") for part in PARTY_PARTS}


def _merge_term(field: Field, current: Any, draft: Any) -> dict[str, Any] | None:
    """
    Settles one either/or term: a length in years, or the open-ended alternative.

    Returns the settled term, or None if the draft did not describe one. Half a
    discriminated union is not a state an agreement can be in, so a term is
    either changed completely or not at all.
    """
    if not isinstance(draft, dict):
        return None

    given_years = draft.get("years")
    kind = draft.get("kind")
    if kind not in (field.counted, field.open_ended):
        # A bare year count only means one thing on a form with these two choices.
        kind = field.counted if given_years is not None else None
    if kind is None:
        return None

    if kind == field.open_ended:
        return {"kind": field.open_ended, "years": None}

    # A length the model did not mention leaves the one already agreed standing
    # — that is what switching back to the counted choice means. A length it did
    # mention and got wrong is not quietly replaced with the old one, though:
    # substituting a number nobody said would put a term in the agreement that
    # neither party chose.
    current_years = current.get("years") if isinstance(current, dict) else None
    stated = given_years if given_years is not None else current_years
    years = clean_years(stated)
    if years is None:
        return None
    return {"kind": field.counted, "years": years}


def merge_patch(
    document: Document, current: dict[str, Any], draft: Any
) -> dict[str, Any]:
    """
    Turns the model's draft into changes the browser can apply as they are.

    Pure, and the only place a model's output becomes a value. A field that
    fails a check is left out of the result entirely.
    """
    if not isinstance(draft, dict):
        return {}

    patch: dict[str, Any] = {}
    for field in document.fields:
        if field.key not in draft:
            continue
        given = draft[field.key]

        if field.type == "party":
            merged = _merge_party(current.get(field.key), given)
        elif field.type == "term":
            merged = _merge_term(field, current.get(field.key), given)
        elif field.type == "date":
            merged = clean_date(given)
        else:
            merged = clean_text(given, LIMITS.get(field.type, MAX_SHORT))

        if merged is not None:
            patch[field.key] = merged

    return patch


def is_answered(field: Field, value: Any) -> bool:
    """Whether this field holds something the finished document could print."""
    if field.type == "party":
        return isinstance(value, dict) and all(
            str(value.get(part, "")).strip() for part in PARTY_PARTS
        )
    if field.type == "term":
        if not isinstance(value, dict):
            return False
        if value.get("kind") == field.open_ended:
            return True
        return clean_years(value.get("years")) is not None
    return bool(str(value or "").strip())


def missing_required(document: Document, state: dict[str, Any]) -> list[Field]:
    """Required fields still waiting for an answer, in the order they are asked."""
    return [
        field
        for field in document.required_fields
        if not is_answered(field, state.get(field.key))
    ]
