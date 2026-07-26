"""Liveness endpoint, used by the Docker healthcheck and the start scripts."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from ..dependencies import get_connection
from ..models import HealthResponse

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(connection: sqlite3.Connection = Depends(get_connection)) -> HealthResponse:
    """
    Reports that the app is up and its schema is in place.

    The start scripts wait on this before declaring the container ready, so it
    touches the database rather than only proving the process is listening.
    """
    connection.execute("SELECT 1 FROM users LIMIT 1").fetchone()
    return HealthResponse(status="ok", database="ready")
