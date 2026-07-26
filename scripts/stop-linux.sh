#!/usr/bin/env bash
#
# Stops Prelegal and removes its container, discarding the database with it.
# Implementation lives in scripts/compose.sh.

set -euo pipefail
exec "$(dirname "${BASH_SOURCE[0]}")/compose.sh" stop
