"""
Runtime settings.

Defaults describe the repository layout, and the Docker image reproduces that
layout (`/app/backend`, `/app/frontend/out`) so the container needs no
environment variables to start.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_ROOT.parent


@dataclass(frozen=True)
class Settings:
    """
    Where the app finds its data and its frontend.

    `dev_origins` is empty whenever the frontend is served from this same origin,
    which is the case in the container — cross-origin requests only happen when
    `next dev` runs the frontend on its own port.
    """

    database_path: Path
    frontend_dir: Path
    dev_origins: tuple[str, ...] = ()


def _env_path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    return Path(value).expanduser().resolve() if value else default


def load_settings() -> Settings:
    """Reads settings from the environment, falling back to the repo layout."""
    origins = os.environ.get("PRELEGAL_DEV_ORIGINS")

    return Settings(
        database_path=_env_path(
            "PRELEGAL_DATABASE_PATH", BACKEND_ROOT / "data" / "prelegal.db"
        ),
        frontend_dir=_env_path(
            "PRELEGAL_FRONTEND_DIR", REPO_ROOT / "frontend" / "out"
        ),
        dev_origins=tuple(
            origin.strip() for origin in origins.split(",") if origin.strip()
        )
        if origins is not None
        else (),
    )
