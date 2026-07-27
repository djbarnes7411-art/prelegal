"""
The drafts table, as functions.

A draft is one user's in-progress copy of one catalog document: the values it
holds and the conversation that produced them, saved after each turn so closing
the tab does not lose either.

Called "draft" here and "document" at the API, because `app/documents/` already
names something else — the compiled catalog, where a "document" is a *kind* of
agreement rather than somebody's copy of one. The same split `routers/auth.py`
already makes against `users.py`.

Ownership is not a check this module performs after fetching; it is part of every
query. Every function takes a `user_id` that goes into the `WHERE` clause, so a
row belonging to someone else is never loaded in the first place.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from typing import Any

_COLUMNS = "id, user_id, document_slug, fields, transcript, created_at, updated_at"


@dataclass(frozen=True)
class Draft:
    id: int
    user_id: int
    document_slug: str
    fields: dict[str, Any]
    messages: list[dict[str, str]]
    """ISO-8601 UTC, as written by SQLite."""
    created_at: str
    updated_at: str


class DraftNotFound(Exception):
    """
    Raised when an id names no row this user owns.

    Deliberately does not distinguish "no such draft" from "someone else's
    draft" — see `routers/documents.py` for why the HTTP answer is the same too.
    """


def _to_draft(row: sqlite3.Row) -> Draft:
    return Draft(
        id=row["id"],
        user_id=row["user_id"],
        document_slug=row["document_slug"],
        fields=json.loads(row["fields"]),
        messages=json.loads(row["transcript"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def create_draft(
    connection: sqlite3.Connection,
    user_id: int,
    document_slug: str,
    fields: dict[str, Any],
    messages: list[dict[str, str]],
) -> Draft:
    """Starts a draft. `fields` is stored as given — the router normalises it."""
    cursor = connection.execute(
        f"INSERT INTO drafts (user_id, document_slug, fields, transcript) "
        f"VALUES (?, ?, ?, ?) RETURNING {_COLUMNS}",
        (user_id, document_slug, json.dumps(fields), json.dumps(messages)),
    )
    row = cursor.fetchone()
    connection.commit()

    return _to_draft(row)


def list_drafts(connection: sqlite3.Connection, user_id: int) -> list[Draft]:
    """This account's drafts, most recently worked on first."""
    rows = connection.execute(
        f"SELECT {_COLUMNS} FROM drafts WHERE user_id = ? "
        f"ORDER BY updated_at DESC, id DESC",
        (user_id,),
    ).fetchall()

    return [_to_draft(row) for row in rows]


def get_draft(connection: sqlite3.Connection, user_id: int, draft_id: int) -> Draft:
    """One draft, or `DraftNotFound` if it does not exist or is not this user's."""
    row = connection.execute(
        f"SELECT {_COLUMNS} FROM drafts WHERE id = ? AND user_id = ?",
        (draft_id, user_id),
    ).fetchone()

    if row is None:
        raise DraftNotFound(draft_id)
    return _to_draft(row)


def update_draft(
    connection: sqlite3.Connection,
    user_id: int,
    draft_id: int,
    fields: dict[str, Any],
    messages: list[dict[str, str]],
) -> Draft:
    """
    Replaces a draft's values and transcript outright.

    A replacement rather than a merge because that is what autosave sends: the
    whole draft as the browser holds it. A dropped request then costs one save,
    not a document whose two halves disagree about what was said.
    """
    cursor = connection.execute(
        f"UPDATE drafts SET fields = ?, transcript = ?, "
        f"updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') "
        f"WHERE id = ? AND user_id = ? RETURNING {_COLUMNS}",
        (json.dumps(fields), json.dumps(messages), draft_id, user_id),
    )
    row = cursor.fetchone()

    if row is None:
        raise DraftNotFound(draft_id)

    connection.commit()
    return _to_draft(row)


def delete_draft(connection: sqlite3.Connection, user_id: int, draft_id: int) -> None:
    """Deletes one draft, or raises `DraftNotFound` if it is not this user's."""
    cursor = connection.execute(
        "DELETE FROM drafts WHERE id = ? AND user_id = ?", (draft_id, user_id)
    )

    if cursor.rowcount == 0:
        raise DraftNotFound(draft_id)

    connection.commit()
