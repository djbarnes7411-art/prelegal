"""
The users table, as functions.

An account carries a real password from PL-7 on, but this module holds none of
the hashing itself: `app/passwords.py` decides how a password becomes a hash and
how one is checked, and this only stores what it is given. `password_hash` is
read in exactly one place — `authenticate_user` — and never leaves this module.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from .passwords import hash_password, verify_password


@dataclass(frozen=True)
class User:
    id: int
    email: str
    """ISO-8601 UTC, as written by SQLite."""
    created_at: str


class EmailAlreadyRegistered(Exception):
    """Raised by `create_user` when the address already has an account."""


class UnknownEmail(Exception):
    """Raised by `authenticate_user` when the address has no account."""


class InvalidPassword(Exception):
    """Raised by `authenticate_user` when the account exists but the password is wrong."""


def normalize_email(email: str) -> str:
    """
    The stored form of an address.

    Applied on both write and read so a lookup cannot miss a row that differs
    only in case or surrounding whitespace.
    """
    return email.strip().lower()


def _to_user(row: sqlite3.Row) -> User:
    return User(id=row["id"], email=row["email"], created_at=row["created_at"])


def create_user(connection: sqlite3.Connection, email: str, password: str) -> User:
    """Registers an address, or raises `EmailAlreadyRegistered`."""
    try:
        cursor = connection.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, ?) "
            "RETURNING id, email, created_at",
            (normalize_email(email), hash_password(password)),
        )
        row = cursor.fetchone()
    except sqlite3.IntegrityError as error:
        raise EmailAlreadyRegistered(email) from error

    connection.commit()
    return _to_user(row)


def authenticate_user(
    connection: sqlite3.Connection, email: str, password: str
) -> User:
    """
    Checks an address and password together.

    Raises `UnknownEmail` and `InvalidPassword` separately rather than answering
    "no" to both, because the two are different mistakes and the login screen
    says so: one is worth offering to fix by creating an account, the other is
    worth retyping. That does let a caller learn whether an address is
    registered — see the note in `routers/auth.py`, where the choice is made.
    """
    row = connection.execute(
        "SELECT id, email, created_at, password_hash FROM users WHERE email = ?",
        (normalize_email(email),),
    ).fetchone()

    if row is None:
        raise UnknownEmail(email)
    if not verify_password(password, row["password_hash"]):
        raise InvalidPassword(email)

    return _to_user(row)


def get_user_by_email(connection: sqlite3.Connection, email: str) -> User | None:
    """Finds an account by address, or `None` if it has never been registered."""
    row = connection.execute(
        "SELECT id, email, created_at FROM users WHERE email = ?",
        (normalize_email(email),),
    ).fetchone()

    return _to_user(row) if row is not None else None


def get_user_by_id(connection: sqlite3.Connection, user_id: int) -> User | None:
    """Finds an account by id — how a session is resolved to whose it is."""
    row = connection.execute(
        "SELECT id, email, created_at FROM users WHERE id = ?", (user_id,)
    ).fetchone()

    return _to_user(row) if row is not None else None
