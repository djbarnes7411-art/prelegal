from __future__ import annotations

import sqlite3

import pytest

from app.users import (
    EmailAlreadyRegistered,
    create_user,
    get_user_by_email,
    normalize_email,
)


def test_create_user_returns_the_stored_record(connection: sqlite3.Connection) -> None:
    user = create_user(connection, "ada@example.com")

    assert user.id > 0
    assert user.email == "ada@example.com"
    assert user.created_at


def test_create_user_rejects_a_duplicate(connection: sqlite3.Connection) -> None:
    create_user(connection, "ada@example.com")

    with pytest.raises(EmailAlreadyRegistered):
        create_user(connection, "ada@example.com")


def test_create_user_rejects_a_duplicate_in_another_case(
    connection: sqlite3.Connection,
) -> None:
    create_user(connection, "ada@example.com")

    with pytest.raises(EmailAlreadyRegistered):
        create_user(connection, "  ADA@Example.com  ")


def test_a_rejected_duplicate_leaves_the_table_usable(
    connection: sqlite3.Connection,
) -> None:
    """The failed INSERT must not leave a transaction open behind it."""
    create_user(connection, "ada@example.com")
    with pytest.raises(EmailAlreadyRegistered):
        create_user(connection, "ada@example.com")

    grace = create_user(connection, "grace@example.com")

    assert get_user_by_email(connection, "grace@example.com") == grace


def test_create_user_normalizes_the_address(connection: sqlite3.Connection) -> None:
    user = create_user(connection, "  Ada@Example.COM  ")

    assert user.email == "ada@example.com"


def test_get_user_by_email_finds_a_registered_address(
    connection: sqlite3.Connection,
) -> None:
    created = create_user(connection, "ada@example.com")

    assert get_user_by_email(connection, "ada@example.com") == created


def test_get_user_by_email_ignores_case_and_whitespace(
    connection: sqlite3.Connection,
) -> None:
    created = create_user(connection, "ada@example.com")

    assert get_user_by_email(connection, " ADA@Example.com ") == created


def test_get_user_by_email_returns_none_when_unregistered(
    connection: sqlite3.Connection,
) -> None:
    assert get_user_by_email(connection, "nobody@example.com") is None


def test_create_user_persists_beyond_the_connection(
    connection: sqlite3.Connection, database_path
) -> None:
    """Without the commit, a second connection would see nothing."""
    from contextlib import closing

    from app.db import connect

    created = create_user(connection, "ada@example.com")

    with closing(connect(database_path)) as other:
        assert get_user_by_email(other, "ada@example.com") == created


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("ada@example.com", "ada@example.com"),
        ("ADA@EXAMPLE.COM", "ada@example.com"),
        ("  ada@example.com\n", "ada@example.com"),
    ],
)
def test_normalize_email(raw: str, expected: str) -> None:
    assert normalize_email(raw) == expected
