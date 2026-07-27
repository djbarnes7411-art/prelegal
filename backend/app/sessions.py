"""
The sessions table, as functions.

A session is an opaque token the browser holds and a hash of that token here.
The token carries no claims and means nothing on its own: it is a name for a row,
and revoking it is deleting the row. That is the whole reason it is opaque rather
than signed — there is no key to keep, and signing out takes effect immediately
instead of at the next expiry.
"""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

TOKEN_BYTES = 32
SESSION_LIFETIME = timedelta(days=14)

_BEARER = "Bearer "


@dataclass(frozen=True)
class Session:
    id: int
    user_id: int
    """ISO-8601 UTC, as written by SQLite."""
    created_at: str
    expires_at: str


def _timestamp(moment: datetime) -> str:
    """The format SQLite writes, so comparisons against stored values sort."""
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def hash_token(token: str) -> str:
    """
    The stored form of a bearer token.

    SHA-256 rather than scrypt, deliberately. Scrypt's cost is there to make
    guessing a human-chosen password expensive; a token is 256 bits from
    `secrets` and has no guessing surface worth defending. Meanwhile this runs on
    every authenticated request rather than once at sign-in, so scrypt here would
    slow the whole product down for nothing. What hashing still buys is that a
    leaked table is not a working set of tokens.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def bearer_token(header_value: str | None) -> str | None:
    """The token in an `Authorization: Bearer <token>` header, or None."""
    if not header_value or not header_value.startswith(_BEARER):
        return None
    return header_value[len(_BEARER) :].strip() or None


def _to_session(row: sqlite3.Row) -> Session:
    return Session(
        id=row["id"],
        user_id=row["user_id"],
        created_at=row["created_at"],
        expires_at=row["expires_at"],
    )


def create_session(
    connection: sqlite3.Connection, user_id: int
) -> tuple[Session, str]:
    """
    Opens a session, leaving any the account already holds untouched.

    Returns the row and the one moment the token itself exists outside the
    caller's browser — from here on the database has only its hash, and a token
    nobody wrote down cannot be recovered, only replaced.
    """
    token = secrets.token_urlsafe(TOKEN_BYTES)
    expires_at = _timestamp(datetime.now(timezone.utc) + SESSION_LIFETIME)

    cursor = connection.execute(
        "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?) "
        "RETURNING id, user_id, created_at, expires_at",
        (user_id, hash_token(token), expires_at),
    )
    row = cursor.fetchone()
    connection.commit()

    return _to_session(row), token


def get_valid_session(connection: sqlite3.Connection, token: str) -> Session | None:
    """
    The session a token names, or None if there is none or it has expired.

    Expired and unknown are not told apart. A caller only ever needs "sign in
    again", and saying which of the two it was would tell someone guessing
    tokens that they had found a real one.
    """
    row = connection.execute(
        "SELECT id, user_id, created_at, expires_at FROM sessions "
        "WHERE token_hash = ? AND expires_at > ?",
        (hash_token(token), _timestamp(datetime.now(timezone.utc))),
    ).fetchone()

    return _to_session(row) if row is not None else None


def delete_session(connection: sqlite3.Connection, token: str) -> None:
    """Ends one session. A token naming no session is already signed out."""
    connection.execute(
        "DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),)
    )
    connection.commit()
