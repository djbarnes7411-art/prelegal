"""
The users table, as functions.

Deliberately free of any notion of credentials: sign-in does not authenticate
yet, so an account here is only a name for whoever is using the platform.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass


@dataclass(frozen=True)
class User:
    id: int
    email: str
    """ISO-8601 UTC, as written by SQLite."""
    created_at: str


class EmailAlreadyRegistered(Exception):
    """Raised by `create_user` when the address already has an account."""


def normalize_email(email: str) -> str:
    """
    The stored form of an address.

    Applied on both write and read so a lookup cannot miss a row that differs
    only in case or surrounding whitespace.
    """
    return email.strip().lower()


def _to_user(row: sqlite3.Row) -> User:
    return User(id=row["id"], email=row["email"], created_at=row["created_at"])


def create_user(connection: sqlite3.Connection, email: str) -> User:
    """Registers an address, or raises `EmailAlreadyRegistered`."""
    try:
        cursor = connection.execute(
            "INSERT INTO users (email) VALUES (?) RETURNING id, email, created_at",
            (normalize_email(email),),
        )
        row = cursor.fetchone()
    except sqlite3.IntegrityError as error:
        raise EmailAlreadyRegistered(email) from error

    connection.commit()
    return _to_user(row)


def get_user_by_email(connection: sqlite3.Connection, email: str) -> User | None:
    """Finds an account by address, or `None` if it has never been registered."""
    row = connection.execute(
        "SELECT id, email, created_at FROM users WHERE email = ?",
        (normalize_email(email),),
    ).fetchone()

    return _to_user(row) if row is not None else None
