"""Shared FastAPI dependencies."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import closing

from fastapi import Depends, Header, HTTPException, Request, status

from .config import Settings
from .db import connect
from .sessions import bearer_token, get_valid_session
from .users import User, get_user_by_id


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_connection(
    settings: Settings = Depends(get_settings),
) -> Iterator[sqlite3.Connection]:
    """
    Opens a connection for the lifetime of one request.

    SQLite connections are cheap to open against a local file, and a fresh one
    per request avoids sharing a cursor across the threadpool that FastAPI runs
    synchronous endpoints on.
    """
    with closing(connect(settings.database_path)) as connection:
        yield connection


def get_current_user(
    authorization: str | None = Header(default=None),
    connection: sqlite3.Connection = Depends(get_connection),
) -> User:
    """
    The account whose token the caller sent, or a 401.

    A missing header, a malformed one, a token naming no session, an expired
    session and a session whose account is gone all fail the same way. The only
    thing a caller can do about any of them is sign in again, and telling them
    apart would hand someone guessing tokens a way to tell a near miss from a
    wrong one.
    """
    token = bearer_token(authorization)
    session = get_valid_session(connection, token) if token else None
    user = get_user_by_id(connection, session.user_id) if session else None

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to continue.",
        )

    return user
