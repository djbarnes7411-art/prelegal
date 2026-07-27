"""The database is rebuilt from scratch on every startup — these pin that."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from app.db import connect, reset_database

# Enough to satisfy the NOT NULL; these tests are about the schema, not hashing.
INSERT_ADA = (
    "INSERT INTO users (email, password_hash) VALUES ('ada@example.com', 'x')"
)


def table_names(connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).fetchall()
    return {row["name"] for row in rows}


def test_creates_the_schema(database_path: Path) -> None:
    reset_database(database_path)

    with closing(connect(database_path)) as connection:
        assert {"users", "sessions", "drafts"} <= table_names(connection)


def test_creates_missing_parent_directories(tmp_path: Path) -> None:
    nested = tmp_path / "data" / "nested" / "prelegal.db"

    reset_database(nested)

    assert nested.exists()


def test_discards_data_from_a_previous_run(database_path: Path) -> None:
    reset_database(database_path)
    with closing(connect(database_path)) as connection:
        connection.execute(INSERT_ADA)
        connection.commit()

    reset_database(database_path)

    with closing(connect(database_path)) as connection:
        count = connection.execute("SELECT count(*) AS n FROM users").fetchone()["n"]
    assert count == 0


def test_removes_sidecar_files(database_path: Path) -> None:
    """A leftover -wal would carry committed rows back into the new database."""
    reset_database(database_path)
    for suffix in ("-wal", "-shm", "-journal"):
        database_path.with_name(database_path.name + suffix).write_bytes(b"stale")

    reset_database(database_path)

    for suffix in ("-wal", "-shm", "-journal"):
        assert not database_path.with_name(database_path.name + suffix).exists()


def test_email_is_unique(connection: sqlite3.Connection) -> None:
    connection.execute(INSERT_ADA)

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(INSERT_ADA)


def test_email_uniqueness_ignores_case(connection: sqlite3.Connection) -> None:
    connection.execute(INSERT_ADA)

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO users (email, password_hash) "
            "VALUES ('ADA@example.com', 'x')"
        )


def test_created_at_is_populated(connection: sqlite3.Connection) -> None:
    row = connection.execute(f"{INSERT_ADA} RETURNING created_at").fetchone()

    assert row["created_at"].endswith("Z")


def test_a_password_hash_is_required(connection: sqlite3.Connection) -> None:
    """No account without one — the column is the whole point of having it."""
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute("INSERT INTO users (email) VALUES ('ada@example.com')")


def test_foreign_keys_are_enforced(connection: sqlite3.Connection) -> None:
    """
    Off by default per connection, so `connect` turns them on.

    Without this the `ON DELETE CASCADE` in schema.sql is silently inert, and a
    deleted account would leave its sessions and drafts behind.
    """
    enabled = connection.execute("PRAGMA foreign_keys").fetchone()[0]

    assert enabled == 1


def test_a_session_needs_an_account_that_exists(
    connection: sqlite3.Connection,
) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO sessions (user_id, token_hash, expires_at) "
            "VALUES (4321, 'hash', '2099-01-01T00:00:00Z')"
        )


def test_a_draft_needs_an_account_that_exists(
    connection: sqlite3.Connection,
) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        connection.execute(
            "INSERT INTO drafts (user_id, document_slug) VALUES (4321, 'mutual-nda')"
        )
