@echo off
chcp 65001 >nul 2>&1
REM Health Tracker - Periodic Processing via Task Scheduler
REM Runs Claude Code to analyze health data.
REM Downloads pending ZIPs from cloud relay.
REM
REM IMPORTANT: Never deletes raw data. Archives instead.
REM IMPORTANT: Re-processes dates when the relay has new pending data (relay = new data = re-analyze).

setlocal enabledelayedexpansion

REM Data dir: auto-detect based on script location
REM If deployed to <data>\processing\ (normal users), parent has profile\
REM If in repo at <repo>\processing\ (dev), parent\coach has profile\
set SCRIPT_PARENT=%~dp0..
if exist "%SCRIPT_PARENT%\profile" (
    set DATA_DIR=%SCRIPT_PARENT%
    set REPO_DIR=%SCRIPT_PARENT%
) else if exist "%SCRIPT_PARENT%\coach\profile" (
    set DATA_DIR=%SCRIPT_PARENT%\coach
    set REPO_DIR=%SCRIPT_PARENT%
) else (
    echo [ERROR] Cannot find coach data directory. Expected profile\ at %SCRIPT_PARENT% or %SCRIPT_PARENT%\coach
    exit /b 1
)
if defined HEALTH_BACKUP_DIR (set BACKUP_DIR=%HEALTH_BACKUP_DIR%) else (set BACKUP_DIR=%USERPROFILE%\health-data-backup)
set LOCK_FILE=%DATA_DIR%\processing.lock

REM --- Get today's date using locale-independent method ---
for /f "usebackq" %%d in (`powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"`) do set TODAY=%%d
if "%TODAY%"=="" (
    echo [ERROR] Failed to determine today's date. Aborting.
    exit /b 1
)

echo [%TODAY%] process-day.bat starting >>"%DATA_DIR%\logs\%TODAY%.log"
echo [%TODAY%] SYNC_URL defined: %HEALTH_SYNC_URL:~0,10% >>"%DATA_DIR%\logs\%TODAY%.log"
echo [%TODAY%] WATCHER_LOCK: %WATCHER_OWNS_LOCK% >>"%DATA_DIR%\logs\%TODAY%.log"

REM --- Lock file check (watcher.ps1 owns lock lifecycle, but guard against direct runs) ---
if defined WATCHER_OWNS_LOCK (
    echo [%TODAY%] Lock owned by watcher - proceeding.
) else if exist "%LOCK_FILE%" (
    echo [%TODAY%] Another processing run is in progress - lock file exists. Aborting.
    exit /b 0
)

echo [%TODAY%] Starting processing run...

REM --- Create required directories ---
mkdir "%DATA_DIR%\logs" 2>nul
mkdir "%DATA_DIR%\archive" 2>nul
mkdir "%BACKUP_DIR%\raw" 2>nul
mkdir "%BACKUP_DIR%\analysis" 2>nul
mkdir "%BACKUP_DIR%\corrections" 2>nul

set EXTRACT_DIR=%DATA_DIR%\incoming\extracted
mkdir "%EXTRACT_DIR%" 2>nul

set ZIP_COUNT=0
set NEW_DATES=

REM --- Sync config: ALWAYS load from sync-config.json in DATA_DIR.
REM     Ignore any inherited env vars -- they cause cross-user contamination
REM     when multiple coach folders share a machine. Watcher.ps1 sets these
REM     env vars per-run; if running directly without watcher, this overwrites
REM     whatever was inherited so we use the right keys for this DATA_DIR.
set HEALTH_SYNC_URL=
set HEALTH_SYNC_KEY=
if not exist "%DATA_DIR%\sync-config.json" (
    echo [%TODAY%] No sync-config.json at %DATA_DIR%. Skipping download, checking local data... >>"%DATA_DIR%\logs\%TODAY%.log"
    set ZIP_COUNT=0
    goto :check_local
)
for /f "usebackq delims=" %%u in (`powershell -NoProfile -Command "(Get-Content -Raw '%DATA_DIR%\sync-config.json' | ConvertFrom-Json).url"`) do set HEALTH_SYNC_URL=%%u
for /f "usebackq delims=" %%k in (`powershell -NoProfile -Command "(Get-Content -Raw '%DATA_DIR%\sync-config.json' | ConvertFrom-Json).key"`) do set HEALTH_SYNC_KEY=%%k
if not defined HEALTH_SYNC_URL (
    echo [%TODAY%] sync-config.json missing url. Skipping download, checking local data... >>"%DATA_DIR%\logs\%TODAY%.log"
    set ZIP_COUNT=0
    goto :check_local
)
if not defined HEALTH_SYNC_KEY (
    echo [%TODAY%] sync-config.json missing key. Skipping download, checking local data... >>"%DATA_DIR%\logs\%TODAY%.log"
    set ZIP_COUNT=0
    goto :check_local
)

echo [%TODAY%] Checking cloud relay for pending data...

REM Get list of pending dates
for /f "usebackq delims=" %%j in (`curl -s "%HEALTH_SYNC_URL%/sync/%HEALTH_SYNC_KEY%/pending"`) do set PENDING_JSON=%%j

REM Parse pending dates using PowerShell
for /f "usebackq delims=" %%d in (`powershell -NoProfile -Command "try { ($env:PENDING_JSON | ConvertFrom-Json).pending -join ',' } catch { '' }"`) do set RELAY_DATES=%%d

REM Save gen map to temp file for use during upload (race condition detection)
set GEN_MAP_FILE=%TEMP%\health-tracker-gen-%RANDOM%.json
powershell -NoProfile -Command "try { $g = ($env:PENDING_JSON | ConvertFrom-Json).gen; if ($g) { $g | ConvertTo-Json } else { '{}' } } catch { '{}' }" > "%GEN_MAP_FILE%" 2>nul

if not "!RELAY_DATES!"=="" (
    echo [%TODAY%] Cloud relay has pending dates: !RELAY_DATES!

    REM Download each pending day. The relay marks dates pending when the phone
    REM uploads new data; Phase 1 will MERGE the new log.json with the existing
    REM analysis (preserving photo analyses keyed by entry id). Do NOT delete the
    REM existing analysis file here -- re-analyzing photos causes calorie
    REM fluctuation on every sync. Preserving existing analysis avoids re-analyzing photos already processed.
    for %%d in (!RELAY_DATES!) do (
        echo [%TODAY%] Downloading %%d from relay...
        curl -sf -o "%EXTRACT_DIR%\health-%%d.zip" "%HEALTH_SYNC_URL%/sync/%HEALTH_SYNC_KEY%/day/%%d"
        if not errorlevel 1 (
            set /a ZIP_COUNT+=1
            set NEW_DATES=!NEW_DATES! %%d
            REM Clear the .uploaded marker so the merged analysis gets re-uploaded after Phase 1.
            REM Keep the analysis JSON itself -- Phase 1 reads it and merges.
            if exist "%DATA_DIR%\analysis\%%d.json.uploaded" (
                del "%DATA_DIR%\analysis\%%d.json.uploaded" >nul 2>&1
            )
            REM Write a reconcile marker: signals that fresh relay data was downloaded for this date.
            REM Phase 1 prompt uses this to force full entry-ID comparison (catches date-moves and
            REM race conditions where a concurrent pass wrote a stale analysis before this download).
            REM Marker is deleted after Phase 1 completes (see cleanup below).
            echo %TODAY% > "%DATA_DIR%\analysis\%%d.json.reconcile"
            REM If the existing analysis JSON is corrupt, delete it so Claude does a full re-process.
            if exist "%DATA_DIR%\analysis\%%d.json" (
                powershell -NoProfile -Command "try { ConvertFrom-Json (Get-Content -Raw '%DATA_DIR%\analysis\%%d.json') | Out-Null; exit 0 } catch { exit 1 }"
                if errorlevel 1 (
                    echo [%TODAY%] Existing analysis for %%d is corrupt - deleting for full re-processing.
                    del "%DATA_DIR%\analysis\%%d.json" >nul 2>&1
                )
            )
            REM Backup raw ZIP locally before any processing
            copy "%EXTRACT_DIR%\health-%%d.zip" "%BACKUP_DIR%\raw\" >nul 2>&1
            REM Extract the downloaded ZIP
            powershell -NoProfile -Command "try { Expand-Archive -LiteralPath '%EXTRACT_DIR%\health-%%d.zip' -DestinationPath '%EXTRACT_DIR%' -Force } catch { Write-Error $_.Exception.Message; exit 1 }"
            REM Also backup extracted data by date
            mkdir "%BACKUP_DIR%\raw\%%d" 2>nul
            xcopy "%EXTRACT_DIR%\*" "%BACKUP_DIR%\raw\%%d\" /E /Y /Q >nul 2>&1
            REM Archive ZIP
            move "%EXTRACT_DIR%\health-%%d.zip" "%DATA_DIR%\archive\" >nul 2>&1
        ) else (
            echo [%TODAY%] WARNING: Failed to download %%d
        )
    )
) else (
    echo [%TODAY%] No pending data on cloud relay.
)

:check_local
if !ZIP_COUNT! equ 0 (
    REM No new downloads, but check if extracted data exists with missing analysis
    set HAS_UNPROCESSED=0
    if exist "%EXTRACT_DIR%\daily" (
        for /d %%d in ("%EXTRACT_DIR%\daily\????-??-??") do (
            set "EDIR_DATE=%%~nxd"
            if not exist "%DATA_DIR%\analysis\!EDIR_DATE!.json" (
                set HAS_UNPROCESSED=1
                echo [%TODAY%] Found unprocessed extracted data for !EDIR_DATE! >>"%DATA_DIR%\logs\%TODAY%.log"
            )
        )
    )
    if "!HAS_UNPROCESSED!"=="0" (
        echo [%TODAY%] No new data to process. Checking for un-uploaded analysis...
        goto :upload_results
    )
    echo [%TODAY%] Processing previously extracted data... >>"%DATA_DIR%\logs\%TODAY%.log"
)

echo [%TODAY%] Processing !ZIP_COUNT! new days of data...

REM --- Build reconcile-dates list to pass to Phase 1 ---
set RECONCILE_DATES=
for %%f in ("%DATA_DIR%\analysis\????-??-??.json.reconcile") do (
    set "RDATE=%%~nf"
    set "RDATE=!RDATE:.json=!"
    set RECONCILE_DATES=!RECONCILE_DATES! !RDATE!
)
if not "!RECONCILE_DATES!"=="" (
    echo [%TODAY%] Reconcile markers found for:!RECONCILE_DATES! >>"%DATA_DIR%\logs\%TODAY%.log"
)

REM --- Phase 1: Run orchestrator ---
echo [%TODAY%] Running orchestrator process_day.py...
for %%D in (!NEW_DATES!) do (
    echo [%TODAY%] Orchestrator: processing %%D >>"%DATA_DIR%\logs\%TODAY%.log"
    python "%REPO_DIR%\processing\process_day.py" --date %%D --data-dir "%DATA_DIR%" --extract-dir "%EXTRACT_DIR%" --backup-dir "%BACKUP_DIR%" >>"%DATA_DIR%\logs\%TODAY%.log" 2>&1
    if errorlevel 1 echo [%TODAY%] WARNING: orchestrator failed for %%D >>"%DATA_DIR%\logs\%TODAY%.log"
)
echo MARKER:orchestrator-done >>"%DATA_DIR%\logs\%TODAY%.log"

REM --- Delete reconcile markers now that Phase 1 has run ---
for %%f in ("%DATA_DIR%\analysis\????-??-??.json.reconcile") do (
    del "%%f" >nul 2>&1
)

echo MARKER:pre-backup >>"%DATA_DIR%\logs\%TODAY%.log"

REM --- Rebuild weekly summary so coach always has fresh numbers ---
node "%REPO_DIR%\coach-plugin\build-summary.js" >>"%DATA_DIR%\logs\%TODAY%.log" 2>&1

REM --- Backup analysis and corrections locally ---
echo [%TODAY%] Backing up analysis and corrections... >>"%DATA_DIR%\logs\%TODAY%.log"
xcopy "%DATA_DIR%\analysis\*.json" "%BACKUP_DIR%\analysis\" /Y /Q >nul 2>&1
xcopy "%DATA_DIR%\corrections\*.json" "%BACKUP_DIR%\corrections\" /Y /Q >nul 2>&1

:upload_results
echo MARKER:upload-start >>"%DATA_DIR%\logs\%TODAY%.log"
REM --- Upload results back to cloud relay ---
REM Upload analysis files that are new or modified since last upload.
REM Uses .uploaded marker files to track state. Catches crashed runs.
REM Always runs -even when no new ZIPs -to catch files from previous failed uploads.
echo [%TODAY%] Uploading analysis results to cloud relay... >>"%DATA_DIR%\logs\%TODAY%.log" 2>&1

if not defined HEALTH_SYNC_URL (
    echo [%TODAY%] WARNING: HEALTH_SYNC_URL not set -skipping upload. >>"%DATA_DIR%\logs\%TODAY%.log"
    goto :upload_done
)

set UPLOAD_COUNT=0
set UPLOAD_FAIL=0
for %%f in ("%DATA_DIR%\analysis\????-??-??.json") do (
    set "ADATE=%%~nf"
    set "NEED_UPLOAD=0"
    if not exist "%%f.uploaded" (
        set "NEED_UPLOAD=1"
    ) else (
        REM Re-upload if analysis was modified after the upload marker (corrections)
        for %%u in ("%%f.uploaded") do for %%a in ("%%f") do (
            if "%%~ta" gtr "%%~tu" set "NEED_UPLOAD=1"
        )
    )
    if "!NEED_UPLOAD!"=="1" (
        echo [%TODAY%] Uploading analysis for !ADATE!... >>"%DATA_DIR%\logs\%TODAY%.log"
        REM Look up gen for this date from the map we captured at /pending time
        set "GEN_PARAM="
        if exist "%GEN_MAP_FILE%" (
            for /f "usebackq delims=" %%g in (`powershell -NoProfile -Command "try { $m = Get-Content '%GEN_MAP_FILE%' -Raw | ConvertFrom-Json; $v = $m.'!ADATE!'; if ($null -ne $v) { '?gen=' + $v } else { '' } } catch { '' }"`) do set "GEN_PARAM=%%g"
        )
        curl -sf -X POST -H "Content-Type: application/json; charset=utf-8" --data-binary @"%%f" "%HEALTH_SYNC_URL%/sync/%HEALTH_SYNC_KEY%/day/!ADATE!/done!GEN_PARAM!" >>"%DATA_DIR%\logs\%TODAY%.log" 2>&1
        if not errorlevel 1 (
            echo [%TODAY%] Uploaded results for !ADATE! >>"%DATA_DIR%\logs\%TODAY%.log"
            echo %TODAY% %TIME% > "%%f.uploaded"
            set /a UPLOAD_COUNT+=1
        ) else (
            echo [%TODAY%] WARNING: Failed to upload results for !ADATE! [curl exit !ERRORLEVEL!] >>"%DATA_DIR%\logs\%TODAY%.log"
            set /a UPLOAD_FAIL+=1
        )
    )
)
if !UPLOAD_COUNT! gtr 0 (
    echo [%TODAY%] Uploaded !UPLOAD_COUNT! analysis files. >>"%DATA_DIR%\logs\%TODAY%.log"
) else (
    echo [%TODAY%] All analysis files up to date. >>"%DATA_DIR%\logs\%TODAY%.log"
)
if !UPLOAD_FAIL! gtr 0 (
    echo [%TODAY%] WARNING: !UPLOAD_FAIL! upload(s) failed -will retry next run. >>"%DATA_DIR%\logs\%TODAY%.log"
)
:upload_done
REM Clean up old upload markers (>30 days)
forfiles /p "%DATA_DIR%\analysis" /m "*.uploaded" /d -30 /c "cmd /c del @path" 2>nul

REM Clean up gen map temp file
if exist "%GEN_MAP_FILE%" del "%GEN_MAP_FILE%" 2>nul

REM --- Clean up extracted data ---
rmdir /s /q "%EXTRACT_DIR%" 2>nul

echo MARKER:bat-done >>"%DATA_DIR%\logs\%TODAY%.log"
echo [%TODAY%] Processing run complete.
endlocal
