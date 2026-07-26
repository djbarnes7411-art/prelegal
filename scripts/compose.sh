#!/usr/bin/env bash
#
# The implementation behind scripts/start-*.sh and scripts/stop-*.sh.
#
# macOS and Linux drive Docker identically, so the per-platform scripts named in
# the project brief are thin wrappers around this one rather than four copies of
# the same logic.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT
readonly URL="http://localhost:8000"
readonly STARTUP_TIMEOUT_SECONDS=300

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed, or not on PATH." >&2
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is required ('docker compose')." >&2
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but not running. Start Docker and try again." >&2
    exit 1
  fi
}

# Polls the health endpoint rather than sleeping a fixed time: the first build
# compiles the frontend and can take minutes, while a rebuild takes seconds.
wait_until_healthy() {
  local deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))

  while ((SECONDS < deadline)); do
    if curl --silent --fail "${URL}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  return 1
}

start() {
  require_docker
  cd "$REPO_ROOT"

  echo "Building and starting Prelegal…"
  docker compose up --build --detach

  if wait_until_healthy; then
    echo
    echo "Prelegal is running at ${URL}"
  else
    echo "The app did not answer within ${STARTUP_TIMEOUT_SECONDS}s. Recent logs:" >&2
    docker compose logs --tail 50 >&2
    exit 1
  fi
}

stop() {
  require_docker
  cd "$REPO_ROOT"

  echo "Stopping Prelegal…"
  docker compose down
  echo "Stopped. The database went with it; the next start creates a fresh one."
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *)
    echo "Usage: $(basename "$0") {start|stop}" >&2
    exit 64
    ;;
esac
