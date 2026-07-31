# Daily dirk@ harvest → ingest → nm_deals.db
#
# Retries: up to $MaxAttempts with backoff between failures.
# Logging: %LOCALAPPDATA%\nm-deal-flow\logs\harvest-YYYYMMDD.log
#
# Registered as Windows Task "NM-DealFlow-DailyHarvest" (see register_daily_task.ps1).

param(
    [int]$Days = 2,              # >1 so a missed morning still catches mail
    [int]$MaxAttempts = 3,
    [int[]]$BackoffSeconds = @(60, 300, 900)  # 1m, 5m, 15m
)

$ErrorActionPreference = "Stop"

$PipelineDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $PipelineDir ".venv\Scripts\python.exe"
$Harvest = Join-Path $PipelineDir "harvest_gmail.py"

$DataRoot = Join-Path $env:LOCALAPPDATA "nm-deal-flow"
$LogDir = Join-Path $DataRoot "logs"
$LocalDb = Join-Path $DataRoot "nm_deals_local.db"
$CloudDb = Join-Path $PipelineDir "nm_deals.db"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd"
$logFile = Join-Path $LogDir "harvest-$stamp.log"

function Write-Log([string]$msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Host $line
}

if (-not (Test-Path $Python)) {
    Write-Log "FATAL: missing venv python at $Python"
    exit 1
}
if (-not (Test-Path (Join-Path $PipelineDir "credentials\token.json"))) {
    Write-Log "FATAL: missing credentials\token.json — re-run gmail_auth.py"
    exit 1
}

# Prefer a local working copy so OneDrive sync cannot corrupt mid-write.
if ((Test-Path $CloudDb) -and (-not (Test-Path $LocalDb))) {
    Copy-Item -LiteralPath $CloudDb -Destination $LocalDb -Force
    Write-Log "seeded local db from OneDrive copy"
} elseif ((Test-Path $CloudDb) -and (Test-Path $LocalDb)) {
    if ((Get-Item $CloudDb).LastWriteTime -gt (Get-Item $LocalDb).LastWriteTime) {
        Copy-Item -LiteralPath $CloudDb -Destination $LocalDb -Force
        Write-Log "refreshed local db from newer OneDrive copy"
    }
}

$env:NM_LOCAL_DB = $LocalDb
$env:PYTHONIOENCODING = "utf-8"

$attempt = 0
$ok = $false
while ($attempt -lt $MaxAttempts -and -not $ok) {
    $attempt++
    Write-Log "attempt $attempt/$MaxAttempts  days=$Days  db=$LocalDb"
    try {
        & $Python $Harvest --days $Days --ingest 2>&1 | ForEach-Object {
            Write-Log ($_ | Out-String).TrimEnd()
        }
        if ($LASTEXITCODE -ne 0) {
            throw "harvest_gmail.py exited with code $LASTEXITCODE"
        }
        $ok = $true
    } catch {
        Write-Log "FAIL attempt $attempt : $_"
        if ($attempt -lt $MaxAttempts) {
            $wait = $BackoffSeconds[[Math]::Min($attempt - 1, $BackoffSeconds.Length - 1)]
            Write-Log "retrying in ${wait}s"
            Start-Sleep -Seconds $wait
        }
    }
}

if (-not $ok) {
    Write-Log "FATAL: all $MaxAttempts attempts failed"
    exit 1
}

# Publish finished bytes back to the project folder as a single overwrite.
Copy-Item -LiteralPath $LocalDb -Destination $CloudDb -Force
Write-Log "published db -> $CloudDb"
Write-Log "SUCCESS"
exit 0
