"""Shared FastAPI dependencies."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import closing

from fastapi import Depends, Request

from .config import Settings
from .db import connect


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
