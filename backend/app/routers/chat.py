"""
The drafting conversation.

Thin, like the other routers: read the request, call `documents.chat.run_turn`,
and turn its two failure modes into something the chat panel can show a person.

One endpoint covers both halves of the conversation. A request with no
`documentSlug` is asking which document to draft; one with a slug is drafting
it. The client does not have to know which mode it is in — it sends what it has
and applies whatever comes back.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from ..config import Settings
from ..dependencies import get_settings
from ..documents.chat import ChatMessage, run_turn
from ..llm import LlmNotConfigured, LlmUnavailable

router = APIRouter(prefix="/api", tags=["chat"])


class ChatTurnRequest(BaseModel):
    """
    Everything needed to answer one message.

    Nothing is stored between turns, so the browser sends the whole context
    every time: what has been said, which document is being drafted, and what
    that document now holds. The caps bound the prompt — and so the latency and
    the bill — on the input the user controls. The values need no cap of their
    own: `normalise` keeps only the fields the chosen document defines, and
    clamps each one, so the prompt is bounded by the document rather than by
    whatever the client sent.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    messages: list[ChatMessage] = Field(min_length=1, max_length=60)
    # Absent until the user has settled on a document. An unknown slug is
    # treated as absent rather than rejected — the conversation can recover from
    # "which document did you want?" and cannot recover from a 422.
    document_slug: str | None = None
    fields: dict[str, Any] = Field(default_factory=dict)


class ChatTurnResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    reply: str
    document_slug: str | None = None
    patch: dict[str, Any] = Field(default_factory=dict)


@router.post("/chat", response_model=ChatTurnResponse)
def chat(
    request: ChatTurnRequest,
    settings: Settings = Depends(get_settings),
) -> ChatTurnResponse:
    """Answers the latest message and reports what it changed."""
    try:
        turn = run_turn(
            request.document_slug,
            request.fields,
            request.messages,
            settings.openrouter_api_key,
        )
    except LlmNotConfigured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "The assistant is not configured on this server, so the "
                "document cannot be filled in yet."
            ),
        ) from None
    except LlmUnavailable:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The assistant is unavailable right now. Try again in a moment.",
        ) from None

    return ChatTurnResponse(
        reply=turn.reply, document_slug=turn.document_slug, patch=turn.patch
    )
