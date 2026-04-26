# Health Tracker Watcher — polls relay for pending data, runs processing if found
# Runs every 30 min via Task Scheduler. Quiet hours: midnight-8am.

# Data dir: auto-detect based on script location
# If deployed to <data>/processing/ (normal users), parent has profile/
# If in repo at <repo>/processing/ (dev), parent/coach has profile/
$parentDir = Split-Path $PSScriptRoot
if (Test-Path (Join-Path $parentDir 'profile')) {
    $dataDir = $parentDir
} elseif (Test-Path (Join-Path (Join-Path $parentDir 'coach') 'profile')) {
    $dataDir = Join-Path $parentDir 'coach'
} else {
    Write-Error "Cannot find coach data directory. Expected profile/ at $parentDir or $parentDir\coach"
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

# Send a Discord embed via Node (per the discord skill pattern). Failures are
# swallowed — we never fail the watcher exit code due to a notification issue.
function Send-DiscordEmbed($title, $description, $color) {
    $webhookPath = Join-Path $env:USERPROFILE '.claude\discord-webhook.txt'
    if (-not (Test-Path $webhookPath)) {
        Log "[watcher] Discord webhook file not found at $webhookPath. Skipping notification."
        return
    }
    try {
        $payload = @{
            username = 'worker: health-tracker'
            embeds = @(@{
                title = $title
                description = $description
                color = $color
                footer = @{ text = 'from: watcher' }
            })
        } | ConvertTo-Json -Depth 6 -Compress
        $tmpScript = Join-Path $env:TEMP "watcher-discord-$PID-$(Get-Random).js"
        $tmpPayload = Join-Path $env:TEMP "watcher-discord-$PID-$(Get-Random).json"
        Set-Content -Path $tmpPayload -Value $payload -Encoding UTF8
        # Use JSON.stringify-safe escaping: backslashes and single quotes
        $escWebhook = $webhookPath.Replace('\','\\').Replace("'","\'")
        $escPayload = $tmpPayload.Replace('\','\\').Replace("'","\'")
        $js = @"
const https = require('https');
const fs = require('fs');
const url = new URL(fs.readFileSync('$escWebhook', 'utf8').trim());
const data = fs.readFileSync('$escPayload', 'utf8');
const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => { res.on('data', () => {}); res.on('end', () => {}); });
req.on('error', () => {});
req.write(data); req.end();
"@
        Set-Content -Path $tmpScript -Value $js -Encoding UTF8
        & node $tmpScript 2>&1 | Out-Null
        Remove-Item $tmpScript -Force -ErrorAction SilentlyContinue
        Remove-Item $tmpPayload -Force -ErrorAction SilentlyContinue
    } catch {
        Log "[watcher] Discord send failed: $_"
    }
}

# Scan the processing log for Claude Code rate-limit messages. If matched,
# write $dataDir\.rate-limit-until (ISO 8601 local time, no tz suffix) and
# notify via Discord. No-op if not matched.
function Check-RateLimit {
    param([long]$StartOffset = 0)
    $procLog = "$dataDir\logs\$today.log"
    if (-not (Test-Path $procLog)) { return }
    try {
        $fs = [System.IO.File]::Open($procLog, 'Open', 'Read', 'ReadWrite')
        try {
            if ($StartOffset -gt 0 -and $StartOffset -lt $fs.Length) {
                $fs.Seek($StartOffset, 'Begin') | Out-Null
            }
            $sr = New-Object System.IO.StreamReader($fs)
            $joined = $sr.ReadToEnd()
            $sr.Close()
        } finally {
            $fs.Close()
        }
    } catch {
        return
    }
    if ($joined -notmatch '(?i)(hit your limit|out of extra usage)') { return }

    # Extract reset hour. Format in the wild: "resets 6pm", "resets 11am", etc.
    $resetDate = $null
    if ($joined -match '(?i)resets\s+(\d{1,2})(am|pm)') {
        $rawHour = [int]$Matches[1]
        $ampm = $Matches[2].ToLower()
        # Convert to 24-hour: 12am=0, 1am-11am=1-11, 12pm=12, 1pm-11pm=13-23
        $hour24 = if ($ampm -eq 'am') {
            if ($rawHour -eq 12) { 0 } else { $rawHour }
        } else {
            if ($rawHour -eq 12) { 12 } else { $rawHour + 12 }
        }
        $now = Get-Date
        $candidate = Get-Date -Year $now.Year -Month $now.Month -Day $now.Day -Hour $hour24 -Minute 0 -Second 0
        if ($candidate -le $now) { $candidate = $candidate.AddDays(1) }
        $resetDate = $candidate
    } else {
        # Defensive fallback: no reset clause parsed, assume 3 hours
        $resetDate = (Get-Date).AddHours(3)
    }

    $iso = $resetDate.ToString('yyyy-MM-ddTHH:mm:ss')
    Set-Content -Path $rateLimitFile -Value $iso -Encoding ascii
    Log "[watcher] Rate limit detected. Pausing until $iso."

    $displayTime = $resetDate.ToString('h:mm tt')
    $desc = "Claude Code hit the usage limit. Next run will resume after $displayTime. No analysis was produced this cycle."
    Send-DiscordEmbed 'Coach processing paused — rate limit' $desc 15105570
}

$hour = (Get-Date).Hour
if ($hour -ge 1 -and $hour -lt 8) {
    Log "Quiet hours (1am-8am). Exiting."
    exit 0
}

# Rate-limit skip check — if Claude Code recently hit its usage limit, pause
# until the reset time. Runs BEFORE lock acquisition and network calls so we
# don't hold a lock or ping the relay while paused. Corrupt/unparseable file =
# treat as not rate-limited (don't deadlock the watcher).
$rateLimitFile = "$dataDir\.rate-limit-until"
if (Test-Path $rateLimitFile) {
    try {
        $rlUntilStr = (Get-Content -Raw $rateLimitFile -ErrorAction Stop).Trim()
        $rlUntil = [datetime]::Parse($rlUntilStr)
        if ((Get-Date) -lt $rlUntil) {
            Log "[watcher] Rate limit active until $($rlUntil.ToString('yyyy-MM-dd HH:mm:ss')). Skipping."
            exit 0
        } else {
            Remove-Item $rateLimitFile -Force -ErrorAction SilentlyContinue
            Log "[watcher] Rate limit window has passed. Resuming."
        }
    } catch {
        Log "[watcher] Could not parse $rateLimitFile ($_). Treating as not rate-limited."
        Remove-Item $rateLimitFile -Force -ErrorAction SilentlyContinue
    }
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

# Sync config: prefer per-datadir sync-config.json (supports multiple users
# sharing one machine), fall back to user-level env vars for legacy single-user setup.
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
if (-not $syncUrl) { $syncUrl = [System.Environment]::GetEnvironmentVariable('HEALTH_SYNC_URL', 'User') }
if (-not $syncKey) { $syncKey = [System.Environment]::GetEnvironmentVariable('HEALTH_SYNC_KEY', 'User') }

if (-not $syncUrl -or -not $syncKey) {
    Log "[watcher] No sync config found (checked $configPath and user env vars). Exiting."
    if (Test-Path $lockFile) { Remove-Item $lockFile -Force }
    exit 0
}

$pendingUrl = "$syncUrl/sync/$syncKey/pending"

try {
    $resp = Invoke-RestMethod -Uri $pendingUrl -Method Get -TimeoutSec 10
    $pending = $resp.pending
    # Capture generation counters so we can detect mid-processing uploads on /done
    $genMap = if ($resp.gen) { $resp.gen } else { @{} }

    if (-not $pending -or $pending.Count -eq 0) {
        Log "[watcher] No pending data. Exiting."
        if (Test-Path $lockFile) { Remove-Item $lockFile -Force }
        exit 0
    }

    Log "[watcher] Pending dates: $($pending -join ', '). Launching processing..."

    try {
        $procLogPath = "$dataDir\logs\$today.log"
        $logOffsetBefore = if (Test-Path $procLogPath) { (Get-Item $procLogPath).Length } else { 0 }
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
                    # Pass the gen we read at the start so the relay can detect stale processing
                    $genVal = if ($genMap -and $genMap.$adate) { $genMap.$adate } else { $null }
                    $doneUrl = "$syncUrl/sync/$syncKey/day/$adate/done"
                    if ($null -ne $genVal) { $doneUrl += "?gen=$genVal" }
                    $resp = Invoke-RestMethod -Uri $doneUrl -Method Post -ContentType 'application/json; charset=utf-8' -InFile $_.FullName -TimeoutSec 30
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

        # Scan only the new log content this run produced. Prior runs today may
        # have logged rate-limit strings that would otherwise trigger false positives.
        Check-RateLimit -StartOffset $logOffsetBefore
    } finally {
        if (Test-Path $lockFile) { Remove-Item $lockFile -Force }
    }
} catch {
    Log "[watcher] Error: $_"
    if (Test-Path $lockFile) { Remove-Item $lockFile -Force }
    exit 1
}
