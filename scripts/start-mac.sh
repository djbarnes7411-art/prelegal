#!/usr/bin/env bash
#
# Starts Prelegal in Docker, then waits until it answers at http://localhost:8000.
# Implementation lives in scripts/compose.sh.

set -euo pipefail
exec "$(dirname "${BASH_SOURCE[0]}")/compose.sh" start
