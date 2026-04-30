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
set SCRIPT_PARENT=%~dp0..
if exist "%SCRIPT_PARENT%\profile" (
    set DATA_DIR=%SCRIPT_PARENT%
    set REPO_DIR=%SCRIPT_PARENT%
) else if exist "%SCRIPT_PARENT%\..\coach\profile" (
    set DATA_DIR=%SCRIPT_PARENT%\..\coach
    set REPO_DIR=%SCRIPT_PARENT%\..
) else (
    echo [ERROR] Cannot find coach data directory.
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

REM --- Detect first run of today (checked before Phase 1) ---
set PHASE2_FIRST_RUN=0
if not exist "%DATA_DIR%\analysis\%TODAY%.json" set PHASE2_FIRST_RUN=1

REM PHASE2_FIRST_RUN is re-checked after relay downloads (relay may delete today's analysis)
set ZIP_COUNT=0
set NEW_DATES=

REM --- Sync config: ALWAYS load from sync-config.json in DATA_DIR.
REM     Ignore any inherited env vars -- they cause cross-user contamination
REM     when multiple coach folders share a machine.
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

if not "!RELAY_DATES!"=="" (
    echo [%TODAY%] Cloud relay has pending dates: !RELAY_DATES!

    REM Download each pending day. The relay marks dates pending when the phone
    REM uploads new data; Phase 1 will MERGE the new log.json with the existing
    REM analysis (preserving photo analyses keyed by entry id). Do NOT delete the
    REM existing analysis file here -- re-analyzing photos causes calorie
    REM fluctuation on every sync. See process-day-prompt.md "Entry-Level Stability".
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

REM Re-check PHASE2_FIRST_RUN — relay may have deleted today's analysis
if not exist "%DATA_DIR%\analysis\%TODAY%.json" set PHASE2_FIRST_RUN=1

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

REM --- Run Claude Code to process extracted data ---
echo [%TODAY%] Running Claude Code analysis...
call claude -p "Process the health data that has been extracted to %EXTRACT_DIR%. Today is %TODAY%. The data root is %DATA_DIR%. Follow the instructions in %REPO_DIR%\processing\process-day-prompt.md. There may be data from multiple days - process each day found." --model sonnet --dangerously-skip-permissions >>"%DATA_DIR%\logs\%TODAY%.log" 2>&1

echo MARKER:claude-done >>"%DATA_DIR%\logs\%TODAY%.log"
if errorlevel 1 (
    echo [%TODAY%] WARNING: Claude Code exited with an error. >>"%DATA_DIR%\logs\%TODAY%.log"
)

echo MARKER:pre-backup >>"%DATA_DIR%\logs\%TODAY%.log"

REM --- Backup analysis and corrections locally ---
echo [%TODAY%] Backing up analysis and corrections... >>"%DATA_DIR%\logs\%TODAY%.log"
xcopy "%DATA_DIR%\analysis\*.json" "%BACKUP_DIR%\analysis\" /Y /Q >nul 2>&1
xcopy "%DATA_DIR%\corrections\*.json" "%BACKUP_DIR%\corrections\" /Y /Q >nul 2>&1

REM --- Phase 2: Conditional plan generation ---
set RUN_PHASE2=0

REM Trigger 1: First processing run of the day
if "!PHASE2_FIRST_RUN!"=="1" (
    set RUN_PHASE2=1
    echo [%TODAY%] Phase 2 trigger: first run of the day. >>"%DATA_DIR%\logs\%TODAY%.log"
)

REM Trigger 2: Goals or preferences changed (hash comparison)
set GOALS_HASH_PATH=%DATA_DIR%\profile\goals.json
set PREFS_HASH_PATH=%DATA_DIR%\profile\preferences.json
if exist "%EXTRACT_DIR%\profile\goals.json" set GOALS_HASH_PATH=%EXTRACT_DIR%\profile\goals.json
if exist "%EXTRACT_DIR%\profile\preferences.json" set PREFS_HASH_PATH=%EXTRACT_DIR%\profile\preferences.json

for /f "usebackq delims=" %%h in (`powershell -NoProfile -Command "$c = ''; if (Test-Path '%GOALS_HASH_PATH%') { $c += Get-Content -Raw '%GOALS_HASH_PATH%' }; if (Test-Path '%PREFS_HASH_PATH%') { $c += Get-Content -Raw '%PREFS_HASH_PATH%' }; $b = [System.Text.Encoding]::UTF8.GetBytes($c); $h = [System.Security.Cryptography.SHA256]::Create().ComputeHash($b); [System.BitConverter]::ToString($h).Replace('-','').ToLower()"`) do set CURRENT_HASH=%%h

set STORED_HASH=
if exist "%DATA_DIR%\last-plan-hash.txt" (
    for /f "usebackq delims=" %%s in ("%DATA_DIR%\last-plan-hash.txt") do set STORED_HASH=%%s
)
if not "!CURRENT_HASH!"=="!STORED_HASH!" (
    if "!RUN_PHASE2!"=="0" echo [%TODAY%] Phase 2 trigger: goals/preferences changed. >>"%DATA_DIR%\logs\%TODAY%.log"
    set RUN_PHASE2=1
)

REM Trigger 3: User requested plan update or plan is stale due to intake/workout deviation
if exist "%DATA_DIR%\analysis\%TODAY%.json" (
    for /f "usebackq delims=" %%r in (`powershell -NoProfile -Command "try { $j = ConvertFrom-Json (Get-Content -Raw '%DATA_DIR%\analysis\%TODAY%.json'); if ($j._planRequested -eq $true -or $j._planStale -eq $true) { 'yes' } else { 'no' } } catch { 'no' }"`) do set PLAN_TRIGGER=%%r
    if "!PLAN_TRIGGER!"=="yes" (
        if "!RUN_PHASE2!"=="0" echo [%TODAY%] Phase 2 trigger: plan requested or stale. >>"%DATA_DIR%\logs\%TODAY%.log"
        set RUN_PHASE2=1
    )
)

REM Trigger 4: Last plan generation was >12 hours ago or missing
set PLAN_TOO_OLD=1
if exist "%DATA_DIR%\last-plan-generation.txt" (
    for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "try { $last = [datetime]::Parse((Get-Content '%DATA_DIR%\last-plan-generation.txt' -Raw).Trim()); if (((Get-Date) - $last).TotalHours -lt 12) { 'fresh' } else { 'stale' } } catch { 'stale' }"`) do set PLAN_AGE=%%t
    if "!PLAN_AGE!"=="fresh" set PLAN_TOO_OLD=0
)
if "!PLAN_TOO_OLD!"=="1" (
    if "!RUN_PHASE2!"=="0" echo [%TODAY%] Phase 2 trigger: plan older than 12 hours or missing. >>"%DATA_DIR%\logs\%TODAY%.log"
    set RUN_PHASE2=1
)

if "!RUN_PHASE2!"=="0" (
    echo [%TODAY%] Phase 2 skipped - plan is current. >>"%DATA_DIR%\logs\%TODAY%.log"
    goto :upload_results
)

REM Guard: Phase 1 must have produced an analysis file
if not exist "%DATA_DIR%\analysis\%TODAY%.json" (
    echo [%TODAY%] Phase 2 skipped - no analysis file for today. >>"%DATA_DIR%\logs\%TODAY%.log"
    goto :upload_results
)

REM --- Run Phase 2: Plan Generation ---
echo [%TODAY%] Running Phase 2: plan generation... >>"%DATA_DIR%\logs\%TODAY%.log"
call claude -p "Generate the meal plan and workout regimen for %TODAY%. The data root is %DATA_DIR%. The extracted data is at %EXTRACT_DIR%. Follow the instructions in %REPO_DIR%\processing\plan-prompt.md." --model sonnet --dangerously-skip-permissions >>"%DATA_DIR%\logs\%TODAY%.log" 2>&1
set PHASE2_EXIT=!ERRORLEVEL!
echo MARKER:phase2-done >>"%DATA_DIR%\logs\%TODAY%.log"
if !PHASE2_EXIT! neq 0 (
    echo [%TODAY%] WARNING: Phase 2 exited with an error. Plan may be incomplete. >>"%DATA_DIR%\logs\%TODAY%.log"
    goto :upload_results
)

REM Phase 2 succeeded - update tracking files
powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'" >"%DATA_DIR%\last-plan-generation.txt"
echo !CURRENT_HASH!>"%DATA_DIR%\last-plan-hash.txt"
echo [%TODAY%] Phase 2 complete - plan generation done. >>"%DATA_DIR%\logs\%TODAY%.log"

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
        curl -sf -X POST -H "Content-Type: application/json; charset=utf-8" --data-binary @"%%f" "%HEALTH_SYNC_URL%/sync/%HEALTH_SYNC_KEY%/day/!ADATE!/done" >>"%DATA_DIR%\logs\%TODAY%.log" 2>&1
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

REM --- Clean up extracted data ---
rmdir /s /q "%EXTRACT_DIR%" 2>nul

echo MARKER:bat-done >>"%DATA_DIR%\logs\%TODAY%.log"
echo [%TODAY%] Processing run complete.
endlocal
