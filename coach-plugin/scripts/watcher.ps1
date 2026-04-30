# Health Tracker Watcher — polls relay for pending data, runs processing if found
# Runs every 30 min via Task Scheduler. Quiet hours: midnight-8am.

# Data dir: auto-detect based on script location
# If deployed to <data>/processing/ (normal users), parent has profile/
# If in repo at <repo>/coach-plugin/scripts/ (dev), ../../coach has profile/
$parentDir = Split-Path $PSScriptRoot
if (Test-Path (Join-Path $parentDir 'profile')) {
    $dataDir = $parentDir
} elseif (Test-Path (Join-Path (Split-Path $parentDir) 'coach' 'profile')) {
    $dataDir = Join-Path (Split-Path $parentDir) 'coach'
} else {
    Write-Error "Cannot find coach data directory."
    exit 1
}
$logDir = "$dataDir\logs"
if (!(Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# Log every run for debugging (append to daily log)
$today = Get-Date -Format 'yyyy-MM-dd'
$logFile = "$logDir\watcher-$today.log"
function Log($msg) {
    $ts = Get-Date -Format 'HH:mm:ss'
    $line = "[$ts] $msg"
    Write-Output $line
    Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue
}

$hour = (Get-Date).Hour
if ($hour -ge 0 -and $hour -lt 8) {
    Log "Quiet hours (12am-8am). Exiting."
    exit 0
}

# Atomic lock file — prevents concurrent processing (TOCTOU-safe)
$lockFile = "$dataDir\processing.lock"

# Try to acquire lock atomically (CreateNew fails if file exists)
$lockAcquired = $false
try {
    $fs = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    $writer = New-Object System.IO.StreamWriter($fs)
    $writer.WriteLine("$PID $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    $writer.Close()
    $fs.Close()
    $lockAcquired = $true
} catch [System.IO.IOException] {
    # Lock exists — check if stale (>60 min)
    $lockAge = (Get-Date) - (Get-Item $lockFile).LastWriteTime
    if ($lockAge.TotalMinutes -lt 60) {
        Log "[watcher] Processing already in progress (lock age: $([int]$lockAge.TotalMinutes) min). Exiting."
        exit 0
    }
    # Stale lock — check if the PID is still alive
    $lockContent = Get-Content $lockFile -ErrorAction SilentlyContinue
    $lockPid = if ($lockContent -match '^\d+') { [int]$Matches[0] } else { 0 }
    if ($lockPid -and (Get-Process -Id $lockPid -ErrorAction SilentlyContinue)) {
        Log "[watcher] Stale lock but PID $lockPid is still running. Killing."
        Stop-Process -Id $lockPid -Force -ErrorAction SilentlyContinue
    }
    Log "[watcher] Removing stale lock file (age: $([int]$lockAge.TotalMinutes) min)."
    Remove-Item $lockFile -Force
    # Re-acquire
    Get-Date -Format 'yyyy-MM-dd HH:mm:ss' | Out-File $lockFile -Encoding ascii
    $lockAcquired = $true
}

if (-not $lockAcquired) {
    Log "[watcher] Failed to acquire lock. Exiting."
    exit 1
}

# Sync config: per-datadir sync-config.json is the ONLY source of truth.
# User-level env vars are intentionally NOT supported -- they cause cross-user
# contamination when multiple coach folders share one machine.
$syncUrl = $null
$syncKey = $null
$configPath = Join-Path $dataDir 'sync-config.json'
if (Test-Path $configPath) {
    try {
        $cfg = Get-Content -Raw $configPath | ConvertFrom-Json
        $syncUrl = $cfg.url
        $syncKey = $cfg.key
        Log "[watcher] Using sync config from $configPath"
    } catch {
        Log "[watcher] Failed to parse $configPath : $_"
    }
}

if (-not $syncUrl -or -not $syncKey) {
    Log "[watcher] No sync config found at $configPath. Exiting."
    if (Test-Path $lockFile) { Remove-Item $lockFile -Force }
    exit 0
}

$pendingUrl = "$syncUrl/sync/$syncKey/pending"

try {
    $resp = Invoke-RestMethod -Uri $pendingUrl -Method Get -TimeoutSec 10
    $pending = $resp.pending

    if (-not $pending -or $pending.Count -eq 0) {
        Log "[watcher] No pending data. Exiting."
        if (Test-Path $lockFile) { Remove-Item $lockFile -Force }
        exit 0
    }

    Log "[watcher] Pending dates: $($pending -join ', '). Launching processing..."

    try {
        $batPath = Join-Path $PSScriptRoot 'process-day.bat'
        $env:CLAUDECODE = $null
        $env:WATCHER_OWNS_LOCK = "1"
        # Ensure sync env vars are in process environment for child bat
        $env:HEALTH_SYNC_URL = $syncUrl
        $env:HEALTH_SYNC_KEY = $syncKey
        $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c `"$batPath`"" -PassThru -NoNewWindow
        # 60-minute timeout — kill if hung
        if (-not $proc.WaitForExit(3600000)) {
            Log "[watcher] Processing timed out after 60 min. Killing."
            $proc | Stop-Process -Force
        }
        Log "[watcher] Processing finished with exit code $($proc.ExitCode)."

        # Fallback upload — bat's upload section may fail silently, so do it here too
        Log "[watcher] Running fallback upload check..."
        $analysisDir = "$dataDir\analysis"
        $uploadCount = 0
        Get-ChildItem -Path $analysisDir -Filter '????-??-??.json' -ErrorAction SilentlyContinue | ForEach-Object {
            $marker = "$($_.FullName).uploaded"
            $needUpload = $false
            if (-not (Test-Path $marker)) {
                $needUpload = $true
            } elseif ($_.LastWriteTime -gt (Get-Item $marker).LastWriteTime) {
                $needUpload = $true
            }
            if ($needUpload) {
                $adate = $_.BaseName
                try {
                    $resp = Invoke-RestMethod -Uri "$syncUrl/sync/$syncKey/day/$adate/done" -Method Post -ContentType 'application/json; charset=utf-8' -InFile $_.FullName -TimeoutSec 30
                    if ($resp.ok) {
                        Get-Date | Out-File $marker -Encoding ascii
                        $uploadCount++
                        Log "[watcher] Uploaded analysis for $adate"
                    }
                } catch {
                    Log "[watcher] Upload failed for $adate : $_"
                }
            }
        }
        if ($uploadCount -gt 0) { Log "[watcher] Uploaded $uploadCount analysis file(s) via fallback." }
    } finally {
        if (Test-Path $lockFile) { Remove-Item $lockFile -Force }
    }
} catch {
    Log "[watcher] Error: $_"
    if (Test-Path $lockFile) { Remove-Item $lockFile -Force }
    exit 1
}
