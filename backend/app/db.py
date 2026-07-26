"""
SQLite connection handling and the once-per-startup schema reset.

The database is scratch space, not a store of record: it is deleted and rebuilt
from `schema.sql` every time the app starts, and the container mounts no volume
over it. Anything a user types is gone on restart, by design, until persistence
becomes a product requirement.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

# SQLite writes these alongside the database file; leaving one behind would
# reintroduce data the reset just deleted.
_SIDECAR_SUFFIXES = ("-wal", "-shm", "-journal")


def connect(database_path: Path) -> sqlite3.Connection:
    """
    Opens a connection with row access by column name.

    `check_same_thread` is off because FastAPI may run a request's dependency and
    its endpoint on different threadpool threads. Each request still gets its own
    connection (see `dependencies.get_connection`), so no connection is ever used
    by two requests at once.
    """
    connection = sqlite3.connect(database_path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    return connection


def reset_database(database_path: Path) -> None:
    """Deletes any existing database and recreates it from `schema.sql`."""
    database_path.parent.mkdir(parents=True, exist_ok=True)

    database_path.unlink(missing_ok=True)
    for suffix in _SIDECAR_SUFFIXES:
        database_path.with_name(database_path.name + suffix).unlink(missing_ok=True)

    with closing(connect(database_path)) as connection:
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        connection.commit()
