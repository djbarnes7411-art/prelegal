#
# Starts Prelegal in Docker, then waits until it answers at http://localhost:8000.
# Implementation lives in scripts/Compose.ps1.
#

& "$PSScriptRoot\Compose.ps1" -Action start
