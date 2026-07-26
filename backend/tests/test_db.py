"""The database is rebuilt from scratch on every startup — these pin that."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from app.db import connect, reset_database


def table_names(connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).fetchall()
    return {row["name"] for row in rows}


def test_creates_the_schema(database_path: Path) -> None:
    reset_database(database_path)

    with closing(connect(database_path)) as connection:
        assert "users" in table_names(connection)


def test_creates_missing_parent_directories(tmp_path: Path) -> None:
    nested = tmp_path / "data" / "nested" / "prelegal.db"

    reset_database(nested)

    assert nested.exists()


def test_discards_data_from_a_previous_run(database_path: Path) -> None:
    reset_database(database_path)
    with closing(connect(database_path)) as connection:
        connection.execute("INSERT INTO users (email) VALUES ('ada@example.com')")
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
    connection.execute("INSERT INTO users (email) VALUES ('ada@example.com')")

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute("INSERT INTO users (email) VALUES ('ada@example.com')")


def test_email_uniqueness_ignores_case(connection: sqlite3.Connection) -> None:
    connection.execute("INSERT INTO users (email) VALUES ('ada@example.com')")

    with pytest.raises(sqlite3.IntegrityError):
        connection.execute("INSERT INTO users (email) VALUES ('ADA@example.com')")


def test_created_at_is_populated(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "INSERT INTO users (email) VALUES ('ada@example.com') RETURNING created_at"
    ).fetchone()

    assert row["created_at"].endswith("Z")
