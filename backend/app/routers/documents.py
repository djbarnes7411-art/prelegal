"""
Saved drafts, at `/api/documents`.

Called "documents" here and "drafts" underneath (`app/drafts.py`) — the product's
word at the edge, the storage layer's word inside, the same split
`routers/auth.py` already makes against `users.py`.

Everything here requires a session, and every route reaches storage with the
caller's own user id, so a draft belonging to another account is never loaded.

`normalise` runs on the way in *and* on the way out. On the way in because a
client can send anything; on the way out because what is on disk was written
against whatever the catalog said at the time, and a document's field list can
change underneath a saved draft. Both directions come back complete — every field
the document defines, present — which is what the browser's shallow merge needs.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from ..dependencies import get_connection, get_current_user
from ..documents.catalog import Document, find
from ..documents.chat import ChatMessage
from ..documents.values import normalise
from ..drafts import (
    Draft,
    DraftNotFound,
    create_draft,
    delete_draft,
    get_draft,
    list_drafts,
    update_draft,
)
from ..users import User

router = APIRouter(prefix="/api/documents", tags=["documents"])

# The transcript autosave sends, bounded the same way `/api/chat` bounds the one
# it is asked to answer — the workspace trims to 40 before either call.
MAX_MESSAGES = 60

_NOT_FOUND = "No document found with that id."


class _Wire(BaseModel):
    """camelCase over the wire, like `/api/chat` — these carry the same shapes."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class DocumentSummary(_Wire):
    """
    One saved draft, without its conversation.

    The values come along because the list screen builds each card's title and
    its "what's left" count from them, using the same catalog the workspace
    does. The transcript does not: it can run to sixty messages and the list
    never shows a word of it.
    """

    id: int
    document_slug: str
    fields: dict[str, Any]
    created_at: str
    updated_at: str


class DocumentResponse(DocumentSummary):
    messages: list[ChatMessage]


class CreateDocumentRequest(_Wire):
    document_slug: str
    fields: dict[str, Any] = Field(default_factory=dict)
    messages: list[ChatMessage] = Field(default_factory=list, max_length=MAX_MESSAGES)


class SaveDocumentRequest(_Wire):
    """
    What autosave sends: the whole draft, not a diff.

    No slug — which document a draft is never changes after it is created, and
    accepting one would be inviting a client to rewrite a Pilot Agreement's
    values into an NDA.
    """

    fields: dict[str, Any] = Field(default_factory=dict)
    messages: list[ChatMessage] = Field(default_factory=list, max_length=MAX_MESSAGES)


def _summary(draft: Draft, document: Document) -> DocumentSummary:
    return DocumentSummary(
        id=draft.id,
        document_slug=draft.document_slug,
        fields=normalise(document, draft.fields),
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )


def _response(draft: Draft, document: Document) -> DocumentResponse:
    return DocumentResponse(
        **_summary(draft, document).model_dump(),
        messages=[ChatMessage.model_validate(message) for message in draft.messages],
    )


def _stored_document(slug: str) -> Document:
    """
    The catalog entry a saved draft names.

    A slug that is no longer in the catalog is a 410 rather than a 404: the
    draft is really there and really the caller's, and saying "gone" lets the
    browser explain that the *document type* was withdrawn instead of implying
    the user's work was never saved.
    """
    document = find(slug)
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=(
                "This document is no longer one this product can draft, so the "
                "draft cannot be opened."
            ),
        )
    return document


def _owned(connection: sqlite3.Connection, user_id: int, draft_id: int) -> Draft:
    try:
        return get_draft(connection, user_id, draft_id)
    except DraftNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND
        ) from None


@router.get("", response_model=list[DocumentSummary])
def index(
    user: User = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_connection),
) -> list[DocumentSummary]:
    """
    Every draft this account has, most recently worked on first.

    A draft whose document has left the catalog is skipped rather than failing
    the whole list — one withdrawn template should not cost someone the sight of
    everything else they have written.
    """
    summaries = []
    for draft in list_drafts(connection, user.id):
        document = find(draft.document_slug)
        if document is not None:
            summaries.append(_summary(draft, document))

    return summaries


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def create(
    request: CreateDocumentRequest,
    user: User = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_connection),
) -> DocumentResponse:
    """Starts a draft of one catalog document."""
    document = find(request.document_slug)
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="That is not one of the documents this product can draft.",
        )

    draft = create_draft(
        connection,
        user.id,
        document.slug,
        normalise(document, request.fields),
        [message.model_dump(by_alias=True) for message in request.messages],
    )
    return _response(draft, document)


@router.get("/{draft_id}", response_model=DocumentResponse)
def show(
    draft_id: int,
    user: User = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_connection),
) -> DocumentResponse:
    """One draft, with the conversation that produced it."""
    draft = _owned(connection, user.id, draft_id)
    return _response(draft, _stored_document(draft.document_slug))


@router.put("/{draft_id}", response_model=DocumentResponse)
def save(
    draft_id: int,
    request: SaveDocumentRequest,
    user: User = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_connection),
) -> DocumentResponse:
    """Replaces a draft's values and transcript. What autosave calls."""
    existing = _owned(connection, user.id, draft_id)
    document = _stored_document(existing.document_slug)

    draft = update_draft(
        connection,
        user.id,
        draft_id,
        normalise(document, request.fields),
        [message.model_dump(by_alias=True) for message in request.messages],
    )
    return _response(draft, document)


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def destroy(
    draft_id: int,
    user: User = Depends(get_current_user),
    connection: sqlite3.Connection = Depends(get_connection),
) -> None:
    """
    Deletes one draft.

    Works even for a draft whose document has left the catalog — being unable to
    open something is no reason to be stuck with it.
    """
    try:
        delete_draft(connection, user.id, draft_id)
    except DraftNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND
        ) from None
