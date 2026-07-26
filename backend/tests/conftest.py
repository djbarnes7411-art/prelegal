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


@pytest.fixture(autouse=True)
def no_real_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """
    Keeps the developer's real key out of the test run.

    Importing `app.config` loads the repo-root `.env`, which on a working
    checkout holds a live OpenRouter key. Every test here substitutes the model,
    but a mistake in one of those substitutions should cost a failed assertion,
    not a real request and a real bill. Tests that need a key set their own.
    """
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)


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
