#
# Stops Prelegal and removes its container, discarding the database with it.
# Implementation lives in scripts/Compose.ps1.
#

& "$PSScriptRoot\Compose.ps1" -Action stop
