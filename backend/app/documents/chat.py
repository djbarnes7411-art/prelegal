"""
One turn of the drafting conversation, for any document in the catalog.

Two things happen here, and which one depends only on whether a document has
been chosen yet:

**Choosing.** With no document, the assistant is a concierge. It matches what
the user describes against the catalog, and when they ask for something we have
no template for it says so plainly and offers the nearest thing we can draft
rather than pretending or failing silently.

**Drafting.** With a document, the assistant asks for that document's fields and
extracts values from the answers. The field list, the prompt and the structured
output schema are all built from the catalog entry, so adding a document is a
definition file rather than a code change.

As before, the browser owns the agreement and the transcript, and sends both
every turn: the state it sends is the truth, not the model's memory of itself.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field as dataclass_field
from datetime import date
from functools import cache
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model
from pydantic.alias_generators import to_camel

from ..llm import CompletionFn, LlmUnavailable, complete_structured
# `FieldDef` rather than `Field`: Pydantic's `Field` is used throughout this
# module to build the schema the model answers with.
from .catalog import Document, Field as FieldDef, catalog, find
from .values import merge_patch, missing_required, normalise

# A reply longer than one message may carry. The transcript is resent every
# turn, so a reply too long to send back is not a bad message — it is every
# future message, failing validation, until it falls out of the window.
MAX_REPLY = 4000


class _Wire(BaseModel):
    """Speaks camelCase, matching the field keys the browser stores values under."""

    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="ignore"
    )


class ChatMessage(_Wire):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class PartyDraft(_Wire):
    """A party as the model may describe it — any subset, any of it wrong."""

    company_name: str | None = Field(default=None, description="Legal company name.")
    signatory_name: str | None = Field(
        default=None, description="Full name of the person signing for this party."
    )
    signatory_title: str | None = Field(
        default=None,
        description="That person's job title, e.g. 'Chief Executive Officer'.",
    )
    notice_address: str | None = Field(
        default=None, description="Email or postal address for legal notices."
    )


@dataclass
class Turn:
    """What one exchange produced."""

    reply: str
    document_slug: str | None = None
    patch: dict[str, Any] = dataclass_field(default_factory=dict)


# --------------------------------------------------------------------------
# The shape asked of the model
# --------------------------------------------------------------------------


def _term_draft(document: Document, field: FieldDef) -> type[BaseModel]:
    return create_model(
        f"{document.slug.title().replace('-', '')}{field.key.title()}Draft",
        __base__=_Wire,
        kind=(
            Literal[field.counted, field.open_ended] | None,
            Field(default=None, description="Which of the two choices applies."),
        ),
        years=(
            int | None,
            Field(
                default=None,
                description=(
                    f"Whole {field.noun}s, only when kind is '{field.counted}'."
                ),
            ),
        ),
    )


def _describe(field: FieldDef) -> str:
    """The description the model reads for one field."""
    parts = [f"{field.label[:1].upper()}{field.label[1:]}."]
    parts.append(f"Called '{field.name}' in the agreement.")
    if field.hint:
        parts.append(field.hint)
    return " ".join(parts)


@cache
def draft_model(slug: str) -> type[BaseModel]:
    """
    The structured-output schema for one document's fields.

    Built per document and cached, so the model is asked for this agreement's
    values by name rather than for a bag of strings it has to label itself.

    Deliberately free of length and range constraints: a bound here would fail
    the whole response over one bad field, taking the reply with it. Semantics
    are `merge_patch`'s job, where a failure costs one field and nothing else.
    """
    document = catalog()[slug]

    definitions: dict[str, Any] = {}
    for field in document.fields:
        if field.type == "party":
            annotation: Any = PartyDraft | None
        elif field.type == "term":
            annotation = _term_draft(document, field) | None
        else:
            annotation = str | None
        definitions[field.key] = (
            annotation,
            Field(default=None, description=_describe(field)),
        )

    patch_model = create_model(
        f"{slug.title().replace('-', '')}Patch", __base__=_Wire, **definitions
    )

    return create_model(
        f"{slug.title().replace('-', '')}Turn",
        __base__=_Wire,
        reply=(
            str,
            Field(
                description=(
                    "Your conversational reply to the user: one to three short "
                    "sentences, plain text, no markdown."
                )
            ),
        ),
        patch=(patch_model, Field(default_factory=patch_model)),
    )


class Selection(_Wire):
    """The concierge's answer: what to say, and which document it settled on."""

    reply: str = Field(
        description=(
            "Your conversational reply: one to three short sentences, plain "
            "text, no markdown."
        )
    )
    document_slug: str | None = Field(
        default=None,
        description=(
            "The slug of the document to start drafting, copied exactly from the "
            "list. Null if the user has not settled on one of them."
        ),
    )


# --------------------------------------------------------------------------
# The prompts
# --------------------------------------------------------------------------

DRAFTING_RULES = """\
Rules:
1. Never invent a value. Fill in a field only from something the user actually \
said. If you are missing something, ask for it rather than guessing.
2. Give no legal advice. Do not recommend terms, amounts, jurisdictions, or \
wording, and do not comment on whether a choice is wise. If asked, say plainly \
that you only record what they decide and suggest they ask a lawyer.
3. Ask about at most two related fields per turn. Never list every remaining \
blank at once, and never re-ask about a field that already has a value unless \
the user raises it.
4. Every reply must end with a question until all required fields have values. \
Say what you recorded, then immediately ask for the next thing you need. Never \
leave the user with nothing to answer.
5. Optional fields may be left out entirely — the standard terms read an \
omitted value as "none" or "not applicable". Do not work through them one by \
one. Once the required fields are done, offer them together in a single \
sentence and let the user pick.
6. The user may correct anything at any time. Treat it as an ordinary change to \
that field and confirm it briefly.
7. Keep replies to one to three short sentences of plain text. No markdown, no \
bullet lists, no asterisks.
8. Once every required field has a value, say so and point the user at the \
Download PDF button instead of asking another question.\
"""


def _field_lines(document: Document) -> str:
    lines = []
    for field in document.fields:
        need = "required" if field.required else "optional"
        if field.type == "party":
            shape = (
                "an object with companyName, signatoryName, signatoryTitle and "
                "noticeAddress"
            )
        elif field.type == "term":
            shape = (
                f'either {{"kind":"{field.counted}","years":N}} or '
                f'{{"kind":"{field.open_ended}"}}'
            )
        elif field.type == "date":
            shape = "a date, as YYYY-MM-DD"
        else:
            shape = "text"

        line = f"- {field.key} ({need}, {shape}): {field.label}"
        if field.hint:
            line += f" — {field.hint}"
        if field.has_default:
            line += " [already filled in with a sensible default — do not ask about it]"
        lines.append(line)
    return "\n".join(lines)


def drafting_prompt(document: Document, today: date) -> str:
    attachment = f"\n{document.attachment}\n" if document.attachment else ""
    return (
        f"You are the assistant inside Prelegal's drafting workspace. The user "
        f"is drafting a {document.name}: {document.summary}\n{attachment}\n"
        f"Each turn you do two things: reply to the user in conversation, and "
        f"extract any new or corrected values from what they just said.\n\n"
        f"The document has exactly these fields, and you may fill in no others:\n"
        f"{_field_lines(document)}\n\n"
        f"{DRAFTING_RULES}\n\n"
        f"Today's date is {today.isoformat()}, for anything said relative to it."
    )


def selection_prompt() -> str:
    lines = []
    for document in catalog().values():
        line = f"- {document.slug}: {document.name} — {document.summary}"
        if document.aliases:
            line += f" (people also call this: {', '.join(document.aliases)})"
        lines.append(line)

    return (
        "You are the assistant inside Prelegal's drafting workspace. The user "
        "has not chosen a document yet, and your only job this turn is to work "
        "out which one they need.\n\n"
        "You can draft exactly these documents and no others:\n"
        + "\n".join(lines)
        + "\n\nRules:\n"
        "1. If what the user describes clearly matches one of the documents "
        "above, set documentSlug to its slug exactly as written. In your reply, "
        "say which document you will draft and immediately ask for the first "
        "thing you need: the two companies and who signs for each.\n"
        "2. If they ask for a kind of legal document that is not on the list, "
        "set documentSlug to null. Say plainly that you cannot draft that one, "
        "name the closest document you can draft and what it covers, and ask "
        "whether they would like to start it. Never imply you can produce "
        "something that is not on the list.\n"
        "3. If what they want is unclear, set documentSlug to null and ask what "
        "they are trying to achieve. Do not guess.\n"
        "4. Never invent a slug. Only the slugs listed above exist.\n"
        "5. Give no legal advice about which document they ought to use for "
        "their situation. Describe what each one covers and let them choose.\n"
        "6. Keep replies to one to three short sentences of plain text. No "
        "markdown, no bullet lists, no asterisks."
    )


def build_messages(
    system: str, history: list[ChatMessage], state: dict[str, Any] | None = None
) -> list[dict[str, str]]:
    """
    The full prompt for one turn: instructions, current state, transcript.

    The state is appended rather than interpolated, so the JSON examples in the
    instructions can be written the way the model should copy them, braces and all.
    """
    if state is not None:
        system = (
            f"{system}\n\nThe document as it stands right now — this, not your "
            "memory of the conversation, is what is already known:\n"
            f"{json.dumps(state, indent=2)}"
        )

    return [
        {"role": "system", "content": system},
        *({"role": message.role, "content": message.content} for message in history),
    ]


# --------------------------------------------------------------------------
# The turn
# --------------------------------------------------------------------------


def ensure_follow_up(reply: str, document: Document, state: dict[str, Any]) -> str:
    """
    Leaves the user with something to answer whenever something is still needed.

    Rule 4 asks the model for this, and a good model obliges. It is enforced
    here too because a conversation is the only way to fill this document in: a
    reply that acknowledges an answer and then stops is a dead end with no form
    to fall back on. Counted from the state rather than recalled by the model,
    so it cannot be wrong about what is left.

    Also where the reply is bounded, because the two have to happen in this
    order. The transcript is resent every turn, so a reply over `MAX_REPLY` is
    not one bad message but every future message, failing validation — and
    clipping before appending the question would put it back over the limit.
    """
    if "?" in reply or not (missing := missing_required(document, state)):
        return reply[:MAX_REPLY]

    nudge = f"Next, I need {missing[0].label} — could you tell me?"
    if not reply:
        return nudge[:MAX_REPLY]

    # Room for the question, which is the part the user actually needs.
    budget = MAX_REPLY - len(nudge) - 1
    return f"{reply[:budget].rstrip()} {nudge}" if budget > 0 else nudge[:MAX_REPLY]


def _ask(
    messages: list[dict[str, str]],
    answer_model: type[BaseModel],
    api_key: str | None,
    completion_fn: CompletionFn | None,
) -> Any:
    """
    One structured call, retried once.

    The cheapest failure to recover from is a single malformed response, and the
    user should not have to retype a message over one.
    """
    try:
        return complete_structured(messages, answer_model, api_key, completion_fn)
    except LlmUnavailable:
        return complete_structured(messages, answer_model, api_key, completion_fn)


def run_turn(
    slug: str | None,
    fields: Any,
    history: list[ChatMessage],
    api_key: str | None,
    completion_fn: CompletionFn | None = None,
    today: date | None = None,
) -> Turn:
    """
    Answers one message, choosing a document first if one has not been chosen.

    Raises `LlmNotConfigured` or `LlmUnavailable` — with no form to fall back on
    there is no quieter way to fail that leaves the user any better off.
    """
    document = find(slug)

    if document is None:
        answer = _ask(
            build_messages(selection_prompt(), history),
            Selection,
            api_key,
            completion_fn,
        )
        # A slug we do not have is the same as no choice at all: the document
        # panel would have nothing to show and the next turn nothing to draft.
        chosen = find(answer.document_slug)
        return Turn(
            reply=answer.reply.strip()[:MAX_REPLY],
            document_slug=chosen.slug if chosen else None,
        )

    state = normalise(document, fields)
    answer = _ask(
        build_messages(
            drafting_prompt(document, today or date.today()), history, state
        ),
        draft_model(document.slug),
        api_key,
        completion_fn,
    )

    patch = merge_patch(document, state, answer.patch.model_dump(by_alias=True))
    reply = ensure_follow_up(answer.reply.strip(), document, {**state, **patch})

    return Turn(reply=reply, document_slug=document.slug, patch=patch)
