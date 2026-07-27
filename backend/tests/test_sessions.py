from __future__ import annotations

import sqlite3

import pytest

from app.sessions import (
    bearer_token,
    create_session,
    delete_session,
    get_valid_session,
    hash_token,
)
from app.users import create_user


@pytest.fixture
def user_id(connection: sqlite3.Connection) -> int:
    return create_user(connection, "ada@example.com", "correct-horse").id


class TestOpeningASession:
    def test_returns_a_row_and_a_token(
        self, connection: sqlite3.Connection, user_id: int
    ) -> None:
        session, token = create_session(connection, user_id)

        assert session.user_id == user_id
        assert session.id > 0
        assert token

    def test_the_token_finds_the_session_again(
        self, connection: sqlite3.Connection, user_id: int
    ) -> None:
        session, token = create_session(connection, user_id)

        assert get_valid_session(connection, token) == session

    def test_the_token_itself_is_never_stored(
        self, connection: sqlite3.Connection, user_id: int
    ) -> None:
        _, token = create_session(connection, user_id)

        stored = connection.execute("SELECT token_hash FROM sessions").fetchone()[0]

        assert stored != token
        assert stored == hash_token(token)

    def test_two_sessions_for_one_account_are_independent(
        self, connection: sqlite3.Connection, user_id: int
    ) -> None:
        _, phone = create_session(connection, user_id)
        _, laptop = create_session(connection, user_id)

        delete_session(connection, phone)

        assert get_valid_session(connection, phone) is None
        assert get_valid_session(connection, laptop) is not None

    def test_it_survives_the_connection_that_made_it(
        self, connection: sqlite3.Connection, database_path
    ) -> None:
        """Without the commit, a second connection would see nothing."""
        from contextlib import closing

        from app.db import connect

        user = create_user(connection, "grace@example.com", "correct-horse")
        session, token = create_session(connection, user.id)

        with closing(connect(database_path)) as other:
            assert get_valid_session(other, token) == session


class TestLookingUpASession:
    def test_an_unknown_token_finds_nothing(
        self, connection: sqlite3.Connection
    ) -> None:
        assert get_valid_session(connection, "not-a-real-token") is None

    def test_an_expired_session_finds_nothing(
        self, connection: sqlite3.Connection, user_id: int
    ) -> None:
        """
        Expiry is enforced by the lookup, not by a sweep.

        Backdated directly rather than by waiting, which is the only way to
        exercise this without a fourteen-day test.
        """
        _, token = create_session(connection, user_id)
        connection.execute(
            "UPDATE sessions SET expires_at = ?", ("2020-01-01T00:00:00Z",)
        )
        connection.commit()

        assert get_valid_session(connection, token) is None

    def test_deleting_the_account_takes_its_sessions_with_it(
        self, connection: sqlite3.Connection, user_id: int
    ) -> None:
        """Exercises `ON DELETE CASCADE`, and so the foreign-key pragma."""
        _, token = create_session(connection, user_id)

        connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        connection.commit()

        assert get_valid_session(connection, token) is None


class TestEndingASession:
    def test_the_token_stops_working(
        self, connection: sqlite3.Connection, user_id: int
    ) -> None:
        _, token = create_session(connection, user_id)

        delete_session(connection, token)

        assert get_valid_session(connection, token) is None

    def test_an_unknown_token_is_not_an_error(
        self, connection: sqlite3.Connection
    ) -> None:
        delete_session(connection, "never-existed")


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("Bearer abc123", "abc123"),
        ("Bearer   abc123  ", "abc123"),
        (None, None),
        ("", None),
        ("abc123", None),
        ("bearer abc123", None),
        ("Basic abc123", None),
        ("Bearer ", None),
        ("Bearer    ", None),
    ],
    ids=[
        "a token",
        "surrounded by spaces",
        "no header",
        "an empty header",
        "no scheme",
        "the wrong case",
        "another scheme",
        "a scheme with nothing after it",
        "a scheme with only spaces after it",
    ],
)
def test_reading_the_authorization_header(
    header: str | None, expected: str | None
) -> None:
    assert bearer_token(header) == expected
