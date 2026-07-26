# syntax=docker/dockerfile:1

# One image, one process, one port. The frontend is exported to static files at
# build time and served by the same FastAPI app that answers /api/*, so there is
# no Node runtime and no reverse proxy in the final image.

# ------------------------------------------------------------------ #
# Frontend: export the Next.js app to static files
# ------------------------------------------------------------------ #
FROM node:24-alpine AS frontend

WORKDIR /build

# Manifests first: dependencies only reinstall when they actually change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# NEXT_PUBLIC_API_BASE_URL is left unset, so the app calls its own origin —
# which, in this image, is the backend below.
RUN npm run build

# ------------------------------------------------------------------ #
# Runtime: FastAPI, serving the API and that export
# ------------------------------------------------------------------ #
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    # Install into the system prefix so uvicorn is on PATH without activation.
    UV_PROJECT_ENVIRONMENT=/usr/local

COPY backend/pyproject.toml backend/uv.lock ./backend/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --project backend --locked --no-dev

COPY backend/ ./backend/
COPY --from=frontend /build/out ./frontend/out
# The document catalog: field definitions, blurbs and aliases, compiled from
# definitions/*.toml by `app.documents.build`. Both halves read this one file —
# the browser imports it, the backend builds its prompts from it — so it is
# committed under `frontend/` where Turbopack can resolve it, and copied here
# separately because the export above carries only the built pages.
COPY frontend/lib/documents/generated/catalog.json \
     ./frontend/lib/documents/generated/catalog.json

# Matches the repository layout, so `config.py`'s defaults resolve with no
# environment variables set.
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--app-dir", "/app/backend", "--host", "0.0.0.0", "--port", "8000"]
