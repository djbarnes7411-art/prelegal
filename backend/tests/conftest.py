from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import connect, reset_database
from app.main import create_app


@pytest.fixture
def database_path(tmp_path: Path) -> Path:
    return tmp_path / "prelegal.db"


@pytest.fixture
def connection(database_path: Path) -> Iterator[sqlite3.Connection]:
    """A connection to a freshly created database."""
    reset_database(database_path)
    with closing(connect(database_path)) as connection:
        yield connection


@pytest.fixture
def settings(database_path: Path, tmp_path: Path) -> Settings:
    """
    Settings for an app with no frontend build.

    Most tests exercise the API, and pointing at a missing export keeps them
    independent of whether anyone has run `npm run build`.
    """
    return Settings(
        database_path=database_path, frontend_dir=tmp_path / "no-such-frontend"
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    """
    An API client.

    Used as a context manager so the lifespan hook runs and the database exists,
    exactly as it does under uvicorn.
    """
    with TestClient(create_app(settings)) as client:
        yield client
