"""
The FastAPI application.

One process serves both halves of the product: `/api/*` is this backend, and
everything else is the statically exported Next.js frontend. That is why there is
a single port to remember (8000) and no reverse proxy in the container.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import Settings, load_settings
from .db import reset_database
from .routers import auth, chat, documents, health

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Builds an app instance. Tests call this with their own settings."""
    resolved = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        reset_database(resolved.database_path)
        logger.info("Database created at %s", resolved.database_path)
        yield

    app = FastAPI(
        title="Prelegal",
        description="Draft legal agreements from Common Paper templates.",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.settings = resolved

    # Only needed when `next dev` serves the frontend from its own port. The
    # container serves both from this origin, where `dev_origins` is empty.
    if resolved.dev_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(resolved.dev_origins),
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(documents.router)
    app.include_router(chat.router)
    _mount_frontend(app, resolved)

    return app


def _mount_frontend(app: FastAPI, settings: Settings) -> None:
    """
    Serves the exported frontend from the root path.

    Mounted after the routers so `/api/*` is matched first, and skipped when the
    export is missing — during backend-only development the frontend runs itself.

    `html=True` serves each route's `index.html` (the export uses trailing
    slashes, so every route is a directory) and Next.js's generated `404.html`
    for anything unrecognised.
    """
    if not settings.frontend_dir.is_dir():
        logger.warning(
            "No frontend build at %s — serving the API only. "
            "Run `npm run build` in frontend/ to serve the app from here.",
            settings.frontend_dir,
        )
        return

    app.mount(
        "/",
        StaticFiles(directory=settings.frontend_dir, html=True),
        name="frontend",
    )


app = create_app()
