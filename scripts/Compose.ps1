#
# The implementation behind scripts/start-windows.ps1 and scripts/stop-windows.ps1.
#
# The PowerShell twin of scripts/compose.sh.
#

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('start', 'stop')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$Url = 'http://localhost:8000'
$StartupTimeoutSeconds = 300

# Docker reports progress on stderr even when it succeeds. Windows PowerShell
# turns a native command's stderr into a terminating NativeCommandError while
# $ErrorActionPreference is 'Stop', so every docker call goes through here: the
# preference is relaxed for the call, and success is judged by exit code.
function Invoke-Docker {
    param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & docker @Arguments
    }
    finally {
        $ErrorActionPreference = $previous
    }
}

function Assert-Docker {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker is not installed, or not on PATH.'
    }

    Invoke-Docker compose version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose v2 is required ('docker compose')."
    }

    Invoke-Docker info | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker is installed but not running. Start Docker Desktop and try again.'
    }
}

# Polls the health endpoint rather than sleeping a fixed time: the first build
# compiles the frontend and can take minutes, while a rebuild takes seconds.
function Wait-UntilHealthy {
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return $true }
        }
        catch {
            # Not up yet; the loop is the retry.
        }
        Start-Sleep -Seconds 1
    }

    return $false
}

function Start-Prelegal {
    Assert-Docker
    Push-Location $RepoRoot
    try {
        Write-Host 'Building and starting Prelegal...'
        Invoke-Docker compose up --build --detach
        if ($LASTEXITCODE -ne 0) { throw 'docker compose up failed.' }

        if (Wait-UntilHealthy) {
            Write-Host ''
            Write-Host "Prelegal is running at $Url"
        }
        else {
            Write-Host "The app did not answer within $StartupTimeoutSeconds seconds. Recent logs:"
            Invoke-Docker compose logs --tail 50
            throw 'Startup timed out.'
        }
    }
    finally {
        Pop-Location
    }
}

function Stop-Prelegal {
    Assert-Docker
    Push-Location $RepoRoot
    try {
        Write-Host 'Stopping Prelegal...'
        Invoke-Docker compose down
        if ($LASTEXITCODE -ne 0) { throw 'docker compose down failed.' }
        Write-Host 'Stopped. The database went with it; the next start creates a fresh one.'
    }
    finally {
        Pop-Location
    }
}

if ($Action -eq 'start') { Start-Prelegal } else { Stop-Prelegal }
