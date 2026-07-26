"""
The drafting conversation.

Thin, like the other routers: read the request, call `nda_chat.run_turn`, and
turn its two failure modes into something the chat panel can show a person.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from ..config import Settings
from ..dependencies import get_settings
from ..llm import LlmNotConfigured, LlmUnavailable
from ..nda_chat import ChatMessage, CoverPage, CoverPagePatch, run_turn

router = APIRouter(prefix="/api/nda", tags=["nda"])


class ChatTurnRequest(BaseModel):
    """
    Everything needed to answer one message.

    Nothing is stored between turns, so the browser sends both halves of the
    context every time: what has been said, and what the agreement now says.
    The caps bound the prompt — and so the latency and the bill — on input the
    user controls.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    messages: list[ChatMessage] = Field(min_length=1, max_length=60)
    cover_page: CoverPage


class ChatTurnResponse(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    reply: str
    patch: CoverPagePatch


@router.post(
    "/chat", response_model=ChatTurnResponse, response_model_exclude_none=True
)
def chat(
    request: ChatTurnRequest,
    settings: Settings = Depends(get_settings),
) -> ChatTurnResponse:
    """Answers the latest message and reports what it changed."""
    try:
        reply, patch = run_turn(
            request.cover_page, request.messages, settings.openrouter_api_key
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

    return ChatTurnResponse(reply=reply, patch=patch)
