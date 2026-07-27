from __future__ import annotations

import sqlite3

import pytest

from app.users import (
    EmailAlreadyRegistered,
    InvalidPassword,
    UnknownEmail,
    authenticate_user,
    create_user,
    get_user_by_email,
    get_user_by_id,
    normalize_email,
)


def test_create_user_returns_the_stored_record(connection: sqlite3.Connection) -> None:
    user = create_user(connection, "ada@example.com", "correct-horse")

    assert user.id > 0
    assert user.email == "ada@example.com"
    assert user.created_at


def test_create_user_rejects_a_duplicate(connection: sqlite3.Connection) -> None:
    create_user(connection, "ada@example.com", "correct-horse")

    with pytest.raises(EmailAlreadyRegistered):
        create_user(connection, "ada@example.com", "correct-horse")


def test_create_user_rejects_a_duplicate_in_another_case(
    connection: sqlite3.Connection,
) -> None:
    create_user(connection, "ada@example.com", "correct-horse")

    with pytest.raises(EmailAlreadyRegistered):
        create_user(connection, "  ADA@Example.com  ", "correct-horse")


def test_a_rejected_duplicate_leaves_the_table_usable(
    connection: sqlite3.Connection,
) -> None:
    """The failed INSERT must not leave a transaction open behind it."""
    create_user(connection, "ada@example.com", "correct-horse")
    with pytest.raises(EmailAlreadyRegistered):
        create_user(connection, "ada@example.com", "correct-horse")

    grace = create_user(connection, "grace@example.com", "correct-horse")

    assert get_user_by_email(connection, "grace@example.com") == grace


def test_create_user_normalizes_the_address(connection: sqlite3.Connection) -> None:
    user = create_user(connection, "  Ada@Example.COM  ", "correct-horse")

    assert user.email == "ada@example.com"


def test_get_user_by_email_finds_a_registered_address(
    connection: sqlite3.Connection,
) -> None:
    created = create_user(connection, "ada@example.com", "correct-horse")

    assert get_user_by_email(connection, "ada@example.com") == created


def test_get_user_by_email_ignores_case_and_whitespace(
    connection: sqlite3.Connection,
) -> None:
    created = create_user(connection, "ada@example.com", "correct-horse")

    assert get_user_by_email(connection, " ADA@Example.com ") == created


def test_get_user_by_email_returns_none_when_unregistered(
    connection: sqlite3.Connection,
) -> None:
    assert get_user_by_email(connection, "nobody@example.com") is None


def test_get_user_by_id_finds_a_registered_account(
    connection: sqlite3.Connection,
) -> None:
    created = create_user(connection, "ada@example.com", "correct-horse")

    assert get_user_by_id(connection, created.id) == created


def test_get_user_by_id_returns_none_for_an_id_that_never_existed(
    connection: sqlite3.Connection,
) -> None:
    assert get_user_by_id(connection, 4321) is None


def test_authenticate_user_returns_the_account_for_the_right_password(
    connection: sqlite3.Connection,
) -> None:
    created = create_user(connection, "ada@example.com", "correct-horse")

    assert authenticate_user(connection, "ada@example.com", "correct-horse") == created


def test_authenticate_user_ignores_case_and_whitespace_in_the_address(
    connection: sqlite3.Connection,
) -> None:
    created = create_user(connection, "ada@example.com", "correct-horse")

    assert (
        authenticate_user(connection, " ADA@Example.com ", "correct-horse") == created
    )


def test_authenticate_user_rejects_the_wrong_password(
    connection: sqlite3.Connection,
) -> None:
    create_user(connection, "ada@example.com", "correct-horse")

    with pytest.raises(InvalidPassword):
        authenticate_user(connection, "ada@example.com", "Correct-Horse")


def test_authenticate_user_rejects_an_unregistered_address(
    connection: sqlite3.Connection,
) -> None:
    with pytest.raises(UnknownEmail):
        authenticate_user(connection, "nobody@example.com", "correct-horse")


def test_the_password_is_not_stored_in_the_clear(
    connection: sqlite3.Connection,
) -> None:
    """
    The whole point of the column, asserted against the table itself.

    Read directly rather than through the repository, because no function here
    returns `password_hash` — which is itself the thing worth keeping true.
    """
    create_user(connection, "ada@example.com", "correct-horse")

    stored = connection.execute("SELECT password_hash FROM users").fetchone()[0]

    assert "correct-horse" not in stored
    assert stored.startswith("scrypt$")


def test_two_accounts_with_one_password_get_different_hashes(
    connection: sqlite3.Connection,
) -> None:
    """Salted, so a leaked table does not show which accounts share a password."""
    create_user(connection, "ada@example.com", "correct-horse")
    create_user(connection, "grace@example.com", "correct-horse")

    hashes = [row[0] for row in connection.execute("SELECT password_hash FROM users")]

    assert hashes[0] != hashes[1]


def test_create_user_persists_beyond_the_connection(
    connection: sqlite3.Connection, database_path
) -> None:
    """Without the commit, a second connection would see nothing."""
    from contextlib import closing

    from app.db import connect

    created = create_user(connection, "ada@example.com", "correct-horse")

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
