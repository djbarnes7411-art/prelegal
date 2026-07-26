"""
The Mutual NDA drafting conversation.

One turn in, one turn out. The browser owns the agreement and the transcript;
this module owns what to ask the model and what to believe of its answer.

Two ideas shape everything here:

**The Cover Page the client sends is the truth, not the transcript.** Every
request carries the agreement's current state, so a correction six turns ago
cannot be lost to a model's summary of itself, and the transcript can be
truncated one day without losing an answer.

**The model's patch is untrusted input.** `merge_patch` is the only place its
output becomes a value, and it drops any field that fails a check rather than
rejecting the whole turn — one hallucinated year should not throw away a good
reply and four good fields alongside it.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .llm import LlmUnavailable, complete_structured
from .llm import CompletionFn

# Bounds on what the model may write into the agreement. Generous enough for a
# real answer, tight enough that a runaway generation cannot fill a legal
# document with prose nobody asked for.
MAX_SHORT = 300
MAX_LONG = 2000
MIN_YEARS = 1
MAX_YEARS = 99
MIN_YEAR = 1900
MAX_YEAR = 2100

# A reply longer than one message may carry. The transcript is resent every
# turn, so a reply too long to send back is not a bad message — it is every
# future message, failing validation, until it falls out of the window.
MAX_REPLY = 4000


class _Wire(BaseModel):
    """
    Speaks camelCase.

    The rest of this API translates snake_case by hand in `lib/api.ts`, which is
    fine for a flat two-field user record. The Cover Page is nested three deep
    with two discriminated unions, and hand-translating it in both directions is
    exactly the kind of code that develops a quiet bug — so the wire format
    matches `CoverPageData` in the frontend field for field instead.
    """

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="ignore"
    )


# --------------------------------------------------------------------------
# The agreement's current state, as the browser holds it
# --------------------------------------------------------------------------


class Party(_Wire):
    company_name: str = ""
    signatory_name: str = ""
    signatory_title: str = ""
    notice_address: str = ""


class MndaTerm(_Wire):
    kind: Literal["expires", "untilTerminated"] = "expires"
    years: int | None = None


class ConfidentialityTerm(_Wire):
    kind: Literal["years", "perpetuity"] = "years"
    years: int | None = None


class CoverPage(_Wire):
    purpose: str = ""
    effective_date: str = ""
    mnda_term: MndaTerm = Field(default_factory=MndaTerm)
    confidentiality_term: ConfidentialityTerm = Field(
        default_factory=ConfidentialityTerm
    )
    governing_law: str = ""
    jurisdiction: str = ""
    modifications: str = ""
    party_one: Party = Field(default_factory=Party)
    party_two: Party = Field(default_factory=Party)


# --------------------------------------------------------------------------
# What the model is allowed to say back
# --------------------------------------------------------------------------


class PartyDraft(_Wire):
    """A party as the model may describe it — any subset, any of it wrong."""

    company_name: str | None = Field(default=None, description="Legal company name.")
    signatory_name: str | None = Field(
        default=None, description="Full name of the person signing for this party."
    )
    signatory_title: str | None = Field(
        default=None, description="That person's job title, e.g. 'Chief Executive Officer'."
    )
    notice_address: str | None = Field(
        default=None, description="Email or postal address for legal notices."
    )


class MndaTermDraft(_Wire):
    kind: Literal["expires", "untilTerminated"] | None = None
    years: int | None = Field(
        default=None, description="Whole years, only when kind is 'expires'."
    )


class ConfidentialityTermDraft(_Wire):
    kind: Literal["years", "perpetuity"] | None = None
    years: int | None = Field(
        default=None, description="Whole years, only when kind is 'years'."
    )


class CoverPageDraft(_Wire):
    """
    The fields the model changed this turn. Anything omitted is left alone.

    Deliberately free of `ge`/`max_length` constraints: a bound here would fail
    the whole response over one bad field, taking the reply with it. Semantics
    are `merge_patch`'s job, where a failure costs one field and nothing else.
    """

    purpose: str | None = Field(
        default=None,
        description="What the parties may use each other's confidential information for.",
    )
    effective_date: str | None = Field(
        default=None, description="The date the agreement starts, as YYYY-MM-DD."
    )
    mnda_term: MndaTermDraft | None = None
    confidentiality_term: ConfidentialityTermDraft | None = None
    governing_law: str | None = Field(
        default=None, description="The US state whose law governs, e.g. 'Delaware'."
    )
    jurisdiction: str | None = Field(
        default=None,
        description="City or county and state where disputes are heard, e.g. 'New Castle, DE'.",
    )
    modifications: str | None = Field(
        default=None, description="Changes to the standard terms, in the user's own words."
    )
    party_one: PartyDraft | None = None
    party_two: PartyDraft | None = None


class LlmTurn(_Wire):
    """One reply and one patch — the shape asked of the model directly."""

    reply: str = Field(
        description=(
            "Your conversational reply to the user: one to three short sentences, "
            "plain text, no markdown."
        )
    )
    patch: CoverPageDraft = Field(default_factory=CoverPageDraft)


class ChatMessage(_Wire):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class CoverPagePatch(_Wire):
    """
    What the browser should merge in.

    Every value here is complete and ready to assign: a party arrives with all
    four of its fields, a term with both of its own. The frontend's state update
    is a shallow merge, so anything less would silently blank the fields the
    model happened not to mention.
    """

    purpose: str | None = None
    effective_date: str | None = None
    mnda_term: MndaTerm | None = None
    confidentiality_term: ConfidentialityTerm | None = None
    governing_law: str | None = None
    jurisdiction: str | None = None
    modifications: str | None = None
    party_one: Party | None = None
    party_two: Party | None = None


# --------------------------------------------------------------------------
# Sanitising
# --------------------------------------------------------------------------


def _clean_text(value: str | None, limit: int) -> str | None:
    """
    A usable answer, or nothing.

    Over-long values are dropped rather than truncated: half a company name
    printed on a signature block reads as a real answer, and asking again is
    the honest outcome.
    """
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if not trimmed or len(trimmed) > limit:
        return None
    return trimmed


def _clean_years(value: object) -> int | None:
    """A whole number of years a term can actually be measured in."""
    # bool is an int in Python, and `True` years is not a term length.
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if not MIN_YEARS <= value <= MAX_YEARS:
        return None
    return value


def _clean_date(value: str | None) -> str | None:
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


def _merge_party(current: Party, draft: PartyDraft | None) -> Party | None:
    """The party with the draft's usable fields applied, or None if none were."""
    if draft is None:
        return None

    fields = {
        "company_name": _clean_text(draft.company_name, MAX_SHORT),
        "signatory_name": _clean_text(draft.signatory_name, MAX_SHORT),
        "signatory_title": _clean_text(draft.signatory_title, MAX_SHORT),
        "notice_address": _clean_text(draft.notice_address, MAX_SHORT),
    }
    accepted = {name: value for name, value in fields.items() if value is not None}
    if not accepted:
        return None

    return current.model_copy(update=accepted)


def _merge_term(
    draft: MndaTermDraft | ConfidentialityTermDraft | None,
    current_years: int | None,
    counted: str,
    open_ended: str,
) -> dict[str, object] | None:
    """
    Settles one of the cover page's two either/or terms.

    Both work the same way — a choice between a length in years and an
    open-ended alternative — so they are settled the same way, and the two
    callers differ only in what those choices are called. `counted` is the
    choice that needs a year count ("expires", "years"); `open_ended` is the one
    that does not ("untilTerminated", "perpetuity").

    Returns the fields of the settled term, or None if the draft did not
    describe one. Half a discriminated union is not a state the agreement can be
    in, so a term is either changed completely or not at all.
    """
    if draft is None:
        return None

    # A bare year count only means one thing on this cover page.
    kind = draft.kind or (counted if draft.years is not None else None)
    if kind is None:
        return None
    if kind == open_ended:
        return {"kind": open_ended, "years": None}

    # A length the model did not mention leaves the one already agreed standing
    # — that is what switching back to the counted choice means. A length it did
    # mention and got wrong is not quietly replaced with the old one, though:
    # substituting a number nobody said would put a term in the agreement that
    # neither party chose.
    stated = draft.years if draft.years is not None else current_years
    years = _clean_years(stated)
    if years is None:
        return None
    return {"kind": counted, "years": years}


def _merge_mnda_term(current: MndaTerm, draft: MndaTermDraft | None) -> MndaTerm | None:
    settled = _merge_term(draft, current.years, "expires", "untilTerminated")
    return MndaTerm.model_validate(settled) if settled else None


def _merge_confidentiality_term(
    current: ConfidentialityTerm, draft: ConfidentialityTermDraft | None
) -> ConfidentialityTerm | None:
    settled = _merge_term(draft, current.years, "years", "perpetuity")
    return ConfidentialityTerm.model_validate(settled) if settled else None


def merge_patch(current: CoverPage, draft: CoverPageDraft) -> CoverPagePatch:
    """
    Turns the model's draft into changes the browser can apply as they are.

    Pure, and the only route from a model's output to the agreement — which is
    why it is also where every check lives. A field that fails one is left out;
    the user is asked about it again next turn, which is what would have
    happened had the model never mentioned it.

    A blank string never clears an answer. The model omitting a field and the
    model sending "" both mean "nothing new here" — including for the optional
    modifications field, because a stray blank wiping a negotiated change is a
    far worse outcome than not being able to clear it by chat.
    """
    return CoverPagePatch(
        purpose=_clean_text(draft.purpose, MAX_LONG),
        effective_date=_clean_date(draft.effective_date),
        mnda_term=_merge_mnda_term(current.mnda_term, draft.mnda_term),
        confidentiality_term=_merge_confidentiality_term(
            current.confidentiality_term, draft.confidentiality_term
        ),
        governing_law=_clean_text(draft.governing_law, MAX_SHORT),
        jurisdiction=_clean_text(draft.jurisdiction, MAX_SHORT),
        modifications=_clean_text(draft.modifications, MAX_LONG),
        party_one=_merge_party(current.party_one, draft.party_one),
        party_two=_merge_party(current.party_two, draft.party_two),
    )


# --------------------------------------------------------------------------
# The prompt
# --------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are the assistant inside Prelegal's Mutual NDA workspace. Each turn you do \
two things: reply to the user in conversation, and extract any new or corrected \
Cover Page values from what they just said.

The Cover Page has exactly nine fields, and you may fill in no others:
- purpose: what the parties may use each other's confidential information for
- effectiveDate: the date the agreement starts, as YYYY-MM-DD
- mndaTerm: {"kind":"expires","years":N} or {"kind":"untilTerminated"}
- confidentialityTerm: {"kind":"years","years":N} or {"kind":"perpetuity"}
- governingLaw: a US state
- jurisdiction: a city or county and state where disputes would be heard
- modifications: free-text changes to the standard terms (optional)
- partyOne and partyTwo: each has companyName, signatoryName, signatoryTitle, \
and noticeAddress (an email or postal address)

Rules:
1. Never invent a value. Fill in a field only from something the user actually \
said. If you are missing something, ask for it rather than guessing.
2. Give no legal advice. Do not recommend term lengths, jurisdictions, or \
wording, and do not comment on whether a choice is wise. If asked, say plainly \
that you only record what they decide and suggest they ask a lawyer.
3. Ask about at most two related fields per turn. Never list every remaining \
blank at once, and never re-ask about a field that already has a value unless \
the user raises it.
4. purpose, effectiveDate, mndaTerm and confidentialityTerm already hold \
sensible defaults. Do not ask about them; change them only if the user does.
5. The user may correct anything at any time. Treat it as an ordinary change to \
that field and confirm it briefly.
6. Keep replies to one to three short sentences of plain text. No markdown, no \
bullet lists, no asterisks.
7. Once every field has a value, say so and point the user at the Download PDF \
button instead of asking another question.\
"""


def build_messages(
    current: CoverPage, history: list[ChatMessage], today: date | None = None
) -> list[dict[str, str]]:
    """
    The full prompt for one turn: instructions, current state, transcript.

    The state is appended rather than interpolated into `SYSTEM_PROMPT`, which
    is a plain string precisely so the JSON examples in it can be written the
    way the model should copy them, braces and all.
    """
    system = (
        f"{SYSTEM_PROMPT}\n\n"
        f"Today's date is {(today or date.today()).isoformat()}, for anything "
        "said relative to it.\n\n"
        "The Cover Page as it stands right now — this, not your memory of the "
        "conversation, is what is already known:\n"
        f"{current.model_dump_json(by_alias=True, indent=2)}"
    )
    return [
        {"role": "system", "content": system},
        *({"role": message.role, "content": message.content} for message in history),
    ]


# --------------------------------------------------------------------------
# The turn
# --------------------------------------------------------------------------


def run_turn(
    current: CoverPage,
    history: list[ChatMessage],
    api_key: str | None,
    completion_fn: CompletionFn | None = None,
    today: date | None = None,
) -> tuple[str, CoverPagePatch]:
    """
    Asks the model for one turn and returns the reply and the changes to apply.

    Retried once, because the cheapest failure to recover from is a single
    malformed response, and the user should not have to retype a message over
    one. Raises `LlmNotConfigured` or `LlmUnavailable` otherwise — with the form
    gone there is no quieter way to fail that leaves the user any better off.
    """
    messages = build_messages(current, history, today)

    try:
        turn = complete_structured(messages, LlmTurn, api_key, completion_fn)
    except LlmUnavailable:
        turn = complete_structured(messages, LlmTurn, api_key, completion_fn)

    return turn.reply.strip()[:MAX_REPLY], merge_patch(current, turn.patch)
